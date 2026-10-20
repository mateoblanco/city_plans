// Vuelve a leer los seguidores de Instagram de los lugares guardados y recalcula prominence, sin
// reprocesarlos: Apify (si ya tiene instagram), y Exa con la marca y el tipo de lugar de Google sólo
// para detectar sucursales de cadena. No llama al LLM ni toca otras columnas.
// --from-snapshots: sin Apify ni Exa, completa los lugares con instagram y sin seguidores con los que midió el
// pipeline (cache/extractions); escribe ig_followers, chain_branch y prominence sin tocar updatedAt.
// Uso: yarn signals:refresh [--dry-run] [--from-snapshots] [--only <id o nombre>,<id o nombre>…]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { refreshSignals, signalsFromSnapshots, type RefreshResult, type SignalsUpdate, type SnapshotSignalsResult } from '../places/refresh-signals.ts'
import { readSnapshots } from '../providers/extraction-snapshots.ts'
import { ApifyInstagramProvider } from '../providers/apify-instagram-provider.ts'
import { ExaPlaceSearchProvider } from '../providers/exa-place-provider.ts'
import { GooglePlacesProvider } from '../providers/google-places-provider.ts'
import { canonical } from '../providers/source-hosts.ts'

const format = (values: SignalsUpdate | null) => values
  ? `${values.igFollowers ?? '—'} seg${values.chainBranch ? ' · cadena' : ''} · ${values.prominence.toFixed(3)}`
  : '—'

function report(results: RefreshResult[], dryRun: boolean) {
  for (const result of results) {
    const mark = result.status === 'changed' ? (dryRun ? 'cambiaría' : 'actualizado') : result.status === 'unchanged' ? 'igual' : 'ERROR'
    console.log(`${mark.padEnd(11)} ${result.name}: ${format(result.before)} → ${format(result.after)}${result.chain ? ' (cadena)' : ''}`)
    for (const warning of result.warnings) console.log(`            aviso: ${warning}`)
    if (result.error) console.log(`            ${result.error}`)
  }
  const count = (status: RefreshResult['status']) => results.filter((result) => result.status === status).length
  console.log(`\n${results.length} lugares: ${count('changed')} ${dryRun ? 'cambiarían' : 'actualizados'}, ${count('unchanged')} iguales, ${count('error')} con error.${dryRun ? ' Dry-run: no se escribió nada.' : ''}`)
}

const nameKey = (value: string) => canonical(value).replace(/[^a-z0-9]+/g, ' ').trim()

/** Ids de --only: cada valor es un id o un nombre (sin acentos ni mayúsculas). Un valor sin match corta el script. */
function onlyIds(rows: { id: string; name: string }[], values: string[]): Set<string> {
  const ids = new Set<string>()
  const missing: string[] = []
  for (const value of values) {
    const matches = rows.filter((row) => row.id === value || nameKey(row.name) === nameKey(value))
    if (matches.length === 0) missing.push(value)
    for (const row of matches) ids.add(row.id)
  }
  if (missing.length > 0) throw new Error(`--only: no hay lugares guardados con id o nombre ${missing.map((value) => `"${value}"`).join(', ')}.`)
  return ids
}

function reportSnapshots(results: SnapshotSignalsResult[], dryRun: boolean) {
  for (const result of results) {
    const mark = result.status === 'changed' ? (dryRun ? 'cambiaría' : 'actualizado') : result.status === 'unchanged' ? 'igual' : 'salteado'
    console.log(`${mark.padEnd(11)} ${result.name}: ${format(result.before)} → ${format(result.after)}${result.reason ? ` (${result.reason})` : ''}`)
  }
  const count = (status: SnapshotSignalsResult['status']) => results.filter((result) => result.status === status).length
  console.log(`\n${results.length} lugares con Instagram y sin seguidores: ${count('changed')} ${dryRun ? 'cambiarían' : 'actualizados'}, ${count('unchanged')} iguales, ${count('skipped')} salteados.${dryRun ? ' Dry-run: no se escribió nada.' : ''}`)
}

const selectRows = (db: Awaited<typeof import('../db/index.ts')>['db']) => db
  .select({
    id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, instagram: places.instagram,
    igFollowers: places.igFollowers, chainBranch: places.chainBranch, prominence: places.prominence,
  })
  .from(places)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const onlyIndex = process.argv.indexOf('--only')
  const only = onlyIndex > 0 ? (process.argv[onlyIndex + 1] ?? '').split(',').map((value) => value.trim()).filter(Boolean) : null
  if (only?.length === 0) throw new Error('--only necesita una lista de ids o nombres separados por coma.')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')

  if (process.argv.includes('--from-snapshots')) {
    const { db } = await import('../db/index.ts')
    const rows = await selectRows(db)
    const results = await signalsFromSnapshots(rows, await readSnapshots(), {
      // Sólo las columnas de prominencia, sin tocar updatedAt: no es una actualización del contenido.
      write: dryRun ? undefined : async (id, values) => {
        await db.update(places).set({ ...values, updatedAt: places.updatedAt }).where(eq(places.id, id))
      },
    }, { onlyIds: only ? onlyIds(rows, only) : undefined })
    reportSnapshots(results, dryRun)
    return
  }
  const exa = new ExaPlaceSearchProvider()
  if (!exa.configured) throw new Error('Falta configurar EXA_API_KEY en .env.local.')
  const instagram = new ApifyInstagramProvider({ token: process.env.APIFY_API_TOKEN, actorId: process.env.APIFY_INSTAGRAM_ACTOR_ID })
  if (!instagram.configured) console.warn('Sin APIFY_API_TOKEN: los seguidores quedan como estaban.')
  const googleKey = process.env.GOOGLE_PLACES_API_KEY?.trim()
  const google = googleKey ? new GooglePlacesProvider(googleKey) : null
  if (!google) console.warn('Sin GOOGLE_PLACES_API_KEY: Exa busca sólo con la marca, sin el tipo de lugar.')
  const { db } = await import('../db/index.ts')

  const rows = await selectRows(db)
  const ids = only ? onlyIds(rows, only) : undefined
  console.log(`${ids ? `${ids.size} de ${rows.length}` : rows.length} lugares guardados${dryRun ? ' (dry-run)' : ''}.\n`)

  const results = await refreshSignals(rows, {
    placeType: google ? (googlePlaceId) => google.getPlaceType(googlePlaceId) : undefined,
    searchPlace: (term) => exa.searchPlace(term),
    scrapeInstagram: (url) => instagram.configured ? instagram.scrape(url) : Promise.reject(new Error('Apify sin configurar')),
    // Sólo las columnas de prominencia; updatedAt avanza por $onUpdate.
    write: dryRun ? undefined : async (id, values) => {
      await db.update(places).set({
        igFollowers: values.igFollowers,
        chainBranch: values.chainBranch,
        prominence: values.prominence,
      }).where(eq(places.id, id))
    },
  }, { onlyIds: ids })
  report(results, dryRun)
  if (results.some((result) => result.status === 'error')) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
