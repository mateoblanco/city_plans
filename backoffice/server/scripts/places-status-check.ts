// Chequea con Google si los lugares publicados siguen abiertos: un Place Details por lugar con sólo businessStatus
// (Place Details Pro). El dato de Google no se guarda: sólo el código del motivo.
// Por defecto no escribe: lista los cerrados (definitivamente o temporalmente), los que Google ya no tiene y los errores,
// con el costo estimado. --write los pasa a review con closed_permanently/closed_temporarily sumado a sus motivos, sin
// borrarlos ni tocar updatedAt. Un lugar con status o motivos puestos a mano se lista pero no se mueve, salvo que su id
// esté en --override (y entonces deja de estar fijado). Cada corrida vuelve a llamar a Google.
// Uso: yarn places:check-status [--write] [--override <id>,…]
import './env.ts'
import { eq, sql } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { GooglePlacesProvider } from '../providers/google-places-provider.ts'
import { PLACE_DETAILS_PRO_USD, checkStatuses, statusWrites, type StatusVerdict } from '../places/status-check.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'
import { REVIEW_REASONS } from '../../src/data/review-reasons.ts'

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

const where = (verdict: StatusVerdict) => {
  const { name, neighborhoodId, id } = verdict.row
  return `${name} (${neighborhoodDisplayName(neighborhoodId) ?? neighborhoodId}) · ${id}`
}

async function main() {
  const write = process.argv.includes('--write')
  const override = new Set((argValue('--override') ?? '').split(',').map((id) => id.trim()).filter(Boolean))
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim()
  if (!key) throw new Error('Falta GOOGLE_PLACES_API_KEY en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = (await db.select({
    id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, neighborhoodId: places.neighborhoodId,
    reviewReasons: places.reviewReasons, manualOverrides: places.manualOverrides,
  }).from(places).where(eq(places.status, 'published')).orderBy(places.name))
    .flatMap((row) => row.googlePlaceId ? [{ ...row, googlePlaceId: row.googlePlaceId, manualOverrides: parseManualOverrides(row.manualOverrides) }] : [])

  const google = new GooglePlacesProvider(key)
  console.log(`Consultando el estado de ${rows.length} lugares publicados en Google…`)
  const verdicts = await checkStatuses(rows, (placeId) => google.getBusinessStatus(placeId))
  const closed = verdicts.filter((verdict) => verdict.kind === 'closed')
  const notFound = verdicts.filter((verdict) => verdict.kind === 'not_found')
  const errors = verdicts.filter((verdict) => verdict.kind === 'error')
  const manualIds = new Set(closed.filter((verdict) => verdict.manual).map((verdict) => verdict.row.id))
  const unknown = [...override].filter((id) => !manualIds.has(id))
  if (unknown.length) throw new Error(`--override sólo acepta ids de cerrados con status a mano: ${unknown.join(', ')}`)

  console.log(`\nCerrados según Google (${closed.length}):`)
  for (const verdict of closed) {
    const manual = verdict.manual ? (override.has(verdict.row.id) ? ' · status a mano: se mueve (--override)' : ' · status a mano: no se mueve sin --override') : ''
    console.log(`  ${where(verdict)} · ${REVIEW_REASONS[verdict.reason]}${manual}`)
  }
  console.log(`\nNo encontrados en Google (${notFound.length}; no se tocan):`)
  for (const verdict of notFound) console.log(`  ${where(verdict)}`)
  if (errors.length) {
    console.log(`\nErrores (${errors.length}; no se tocan, se pueden volver a chequear):`)
    for (const verdict of errors) console.log(`  ${where(verdict)} · ${verdict.error}`)
  }
  const cost = rows.length * PLACE_DETAILS_PRO_USD
  console.log(`\n${rows.length} llamadas a Place Details Pro · USD ${cost.toFixed(2)} a precio de lista (USD ${PLACE_DETAILS_PRO_USD * 1000} cada 1.000; los primeros 5.000 del mes son gratis).`)

  const writes = statusWrites(verdicts, override)
  if (!write) {
    console.log(`Sin escribir: --write pasa ${writes.length} a revisión con su motivo${manualIds.size ? `; los de status a mano, sólo con --override <id>,…` : ''}.`)
    return
  }
  for (const target of writes) {
    await db.update(places).set({
      status: 'review',
      reviewReasons: target.reviewReasons,
      ...(target.clearManualStatus ? { manualOverrides: sql`${places.manualOverrides} - 'status' - 'review_reasons'` } : {}),
      updatedAt: places.updatedAt,
    }).where(eq(places.id, target.id))
  }
  console.log(`Escritos: ${writes.length}.`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
