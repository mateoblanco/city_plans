// Recalcula sea_view de todos los lugares por la distancia a la Rambla (server/places/sea-view.ts), sin buscar nada
// nuevo. Por defecto no escribe: lista los que ganan o pierden sea_view con su distancia, los que un override deja como
// están y los que quedan cerca del umbral, más el costo estimado de los embeddings. --write escribe tags, los textos de
// búsqueda y el embedding de los que cambian, sin updatedAt.
// Uso: yarn sea-view:recompute [--write]
import './env.ts'
import { eq, sql } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { gatewayEmbedder } from '../places/save.ts'
import { applySearchTextChanges, planTagsChange, type SearchTextRow, type TagsChange } from '../places/search-text-backfill.ts'
import { isSeaView, ramblaGeography, SEA_VIEW_METERS } from '../places/sea-view.ts'
import { applyOverrides } from '../places/manual-overrides.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'

/** Hasta dónde se listan los que no cambian, para ver qué pasaría moviendo el umbral. */
const NEAR_LIST_METERS = 150

async function main() {
  const write = process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = (await db
    .select({
      id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, neighborhoodId: places.neighborhoodId, status: places.status,
      descriptionEs: places.descriptionEs, descriptionEn: places.descriptionEn, locatedIn: places.locatedIn, categories: places.categories,
      tags: places.tags, dietVegan: places.dietVegan, dietVegetarian: places.dietVegetarian, dietGlutenFree: places.dietGlutenFree,
      highlights: places.highlights, dishes: places.dishes, signature: places.signature, style: places.style, manualOverrides: places.manualOverrides,
      distance: sql<number>`ST_Distance(${places.location}, ${ramblaGeography()})`.mapWith(Number),
    })
    .from(places))
    .map((row) => ({ ...row, manualOverrides: parseManualOverrides(row.manualOverrides) }))

  const meters = (value: number) => `${Math.round(value)} m`
  const changes: (TagsChange & { distance: number })[] = []
  const lockedLines: string[] = []
  const nearLines: string[] = []
  for (const row of rows.sort((a, b) => a.distance - b.distance)) {
    const near = row.distance <= SEA_VIEW_METERS
    const change = planTagsChange(row as SearchTextRow, { tags: near ? ['sea_view'] : [] }, isSeaView)
    if (change) changes.push({ ...change, distance: row.distance })
    const final = applyOverrides({ tags: row.tags }, row.manualOverrides).tags!.includes('sea_view')
    const locked = row.manualOverrides.tags?.add.includes('sea_view') || row.manualOverrides.tags?.remove.includes('sea_view')
    const line = `${row.name} · ${row.neighborhoodId} · ${meters(row.distance)} · ${row.status}`
    if (locked && near !== final) lockedLines.push(`${line} · ${final ? 'agregado' : 'sacado'} a mano: queda ${final ? 'con' : 'sin'} sea_view`)
    else if (!change && row.distance <= NEAR_LIST_METERS) nearLines.push(`${line} · ${final ? 'ya tiene' : 'sin'} sea_view`)
  }

  const gain = changes.filter((change) => change.added.length)
  const lose = changes.filter((change) => change.removed.length)
  const line = (change: TagsChange & { distance: number }) => {
    const row = rows.find((entry) => entry.id === change.id)!
    return `  ${change.name} · ${row.neighborhoodId} · ${meters(change.distance)} · ${row.status} · embedding US$ ${change.estimatedEmbeddingUsd.toFixed(6)}`
  }
  console.log(`Umbral: ${SEA_VIEW_METERS} m de la Rambla (sin la rambla portuaria).\n`)
  console.log(`Ganan sea_view (${gain.length}):`)
  for (const change of gain) console.log(line(change))
  console.log(`\nPierden sea_view (${lose.length}):`)
  for (const change of lose) console.log(line(change))
  console.log(`\nOverride manual, no cambian (${lockedLines.length}):`)
  for (const entry of lockedLines) console.log(`  ${entry}`)
  console.log(`\nSin cambios a menos de ${NEAR_LIST_METERS} m (${nearLines.length}):`)
  for (const entry of nearLines) console.log(`  ${entry}`)
  const total = changes.reduce((sum, change) => sum + change.estimatedEmbeddingUsd, 0)
  console.log(`\n${changes.length} de ${rows.length} lugares cambian. Embeddings: US$ ${total.toFixed(6)} aprox.`)
  if (!write) {
    console.log('Sin escribir: --write escribe tags, textos de búsqueda y embeddings.')
    return
  }
  const overridesById = new Map(rows.map((row) => [row.id, row.manualOverrides]))
  const result = await applySearchTextChanges(changes, {
    embed: gatewayEmbedder,
    // planTagsChange ya respeta los overrides; aplicarlos otra vez al escribir no cambia nada y protege el camino.
    write: async (id, values) => {
      await db.update(places).set({ ...applyOverrides(values, overridesById.get(id) ?? {}), updatedAt: places.updatedAt }).where(eq(places.id, id))
    },
  })
  console.log(`Escritos: ${result.written}.${result.embedError ? ` ${result.embedError}` : ''}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
