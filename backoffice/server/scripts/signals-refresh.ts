// Vuelve a contar menciones editoriales, lista/premio y seguidores de los lugares guardados, sin
// reprocesarlos: sólo Exa (con la marca) y Apify (si ya tiene instagram). No llama al LLM ni toca
// otras columnas. Uso: yarn signals:refresh [--dry-run]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { refreshSignals, type RefreshResult, type SignalsUpdate } from '../places/refresh-signals.ts'
import { ApifyInstagramProvider } from '../providers/apify-instagram-provider.ts'
import { ExaPlaceSearchProvider } from '../providers/exa-place-provider.ts'

const format = (values: SignalsUpdate | null) => values
  ? `${values.editorialMentions} men · ${values.listedOrAwarded ? 'lista' : '—'} · ${values.igFollowers ?? '—'} seg · ${values.prominence.toFixed(3)}`
  : '—'

function report(results: RefreshResult[], dryRun: boolean) {
  for (const result of results) {
    const mark = result.status === 'changed' ? (dryRun ? 'cambiaría' : 'actualizado') : result.status === 'unchanged' ? 'igual' : 'ERROR'
    console.log(`${mark.padEnd(11)} ${result.name}: ${format(result.before)} → ${format(result.after)}${result.chain ? ' (cadena)' : ''}`)
    if (result.editorialHosts.length > 0) console.log(`            editoriales: ${result.editorialHosts.join(', ')}`)
    for (const warning of result.warnings) console.log(`            aviso: ${warning}`)
    if (result.error) console.log(`            ${result.error}`)
  }
  const count = (status: RefreshResult['status']) => results.filter((result) => result.status === status).length
  console.log(`\n${results.length} lugares: ${count('changed')} ${dryRun ? 'cambiarían' : 'actualizados'}, ${count('unchanged')} iguales, ${count('error')} con error.${dryRun ? ' Dry-run: no se escribió nada.' : ''}`)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const exa = new ExaPlaceSearchProvider()
  if (!exa.configured) throw new Error('Falta configurar EXA_API_KEY en .env.local.')
  const instagram = new ApifyInstagramProvider({ token: process.env.APIFY_API_TOKEN, actorId: process.env.APIFY_INSTAGRAM_ACTOR_ID })
  if (!instagram.configured) console.warn('Sin APIFY_API_TOKEN: los seguidores quedan como estaban.')
  const { db } = await import('../db/index.ts')

  const rows = await db
    .select({
      id: places.id, name: places.name, instagram: places.instagram, website: places.website,
      editorialMentions: places.editorialMentions, listedOrAwarded: places.listedOrAwarded, igFollowers: places.igFollowers, prominence: places.prominence,
    })
    .from(places)
  console.log(`${rows.length} lugares guardados${dryRun ? ' (dry-run)' : ''}.\n`)

  const results = await refreshSignals(rows, {
    searchPlace: (brand) => exa.searchPlace(brand),
    scrapeInstagram: (url) => instagram.configured ? instagram.scrape(url) : Promise.reject(new Error('Apify sin configurar')),
    // Sólo las cuatro columnas de prominencia; updatedAt avanza por $onUpdate.
    write: dryRun ? undefined : async (id, values) => {
      await db.update(places).set({
        editorialMentions: values.editorialMentions,
        listedOrAwarded: values.listedOrAwarded,
        igFollowers: values.igFollowers,
        prominence: values.prominence,
      }).where(eq(places.id, id))
    },
  })
  report(results, dryRun)
  if (results.some((result) => result.status === 'error')) process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
