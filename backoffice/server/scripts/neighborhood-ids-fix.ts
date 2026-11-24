// Pasa los ids de barrio con la Ñ mal decodificada ("LARRAÃ‘AGA", como venían del GeoJSON del INE) a los actuales
// ("LARRAÑAGA", LEGACY_NEIGHBORHOOD_IDS de /shared/neighborhood-names.ts) en todo lo que los guarda: places, guides,
// guide_intros y los candidatos del cruce de descuentos (discount_places.match_candidates). Sin llamadas pagas. Por
// defecto no escribe: lista cada fila antes → después y avisa los ids que no son de ningún barrio (no los toca).
// --write escribe todo en una sola transacción, sin tocar updatedAt (el nombre visible del barrio no cambia).
// Uso: yarn neighborhoods:fix-ids [--write]
import './env.ts'
import { eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { discountPlaces, guideIntros, guides, places } from '../db/schema.ts'
import { LEGACY_NEIGHBORHOOD_IDS, NEIGHBORHOOD_NAMES, currentNeighborhoodId } from '../../src/data/neighborhood-names.ts'
import type { MatchCandidate } from '../../src/types/discounts.ts'

const LEGACY = Object.keys(LEGACY_NEIGHBORHOOD_IDS)
const arrow = (id: string) => `${JSON.stringify(id)} → ${JSON.stringify(currentNeighborhoodId(id))}`

async function main() {
  const write = process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')

  const [placeRows, guideRows, introRows, discountRows, placeIds, guideIds, introIds] = await Promise.all([
    db.select({ id: places.id, name: places.name, status: places.status, neighborhoodId: places.neighborhoodId }).from(places).where(inArray(places.neighborhoodId, LEGACY)),
    db.select({ id: guides.id, slug: guides.slug, neighborhoodId: guides.neighborhoodId }).from(guides).where(inArray(guides.neighborhoodId, LEGACY)),
    db.select({ city: guideIntros.city, neighborhoodId: guideIntros.neighborhoodId }).from(guideIntros).where(inArray(guideIntros.neighborhoodId, LEGACY)),
    db.select({ id: discountPlaces.id, name: discountPlaces.sourceName, matchCandidates: discountPlaces.matchCandidates }).from(discountPlaces)
      .where(sql`exists (select 1 from jsonb_array_elements(${discountPlaces.matchCandidates}) c where c->>'neighborhoodId' in (${sql.join(LEGACY.map((id) => sql`${id}`), sql`, `)}))`),
    db.selectDistinct({ id: places.neighborhoodId }).from(places),
    db.selectDistinct({ id: guides.neighborhoodId }).from(guides).where(isNotNull(guides.neighborhoodId)),
    db.selectDistinct({ id: guideIntros.neighborhoodId }).from(guideIntros).where(isNotNull(guideIntros.neighborhoodId)),
  ])

  console.log(`places (${placeRows.length}):`)
  for (const row of placeRows) console.log(`  ${row.name} [${row.status}] ${arrow(row.neighborhoodId)}`)
  console.log(`guides (${guideRows.length}):`)
  for (const row of guideRows) console.log(`  ${row.slug} ${arrow(row.neighborhoodId!)}`)
  console.log(`guide_intros (${introRows.length}):`)
  for (const row of introRows) console.log(`  ${row.city} ${arrow(row.neighborhoodId!)}`)

  const discountUpdates = discountRows.map((row) => ({
    ...row,
    next: row.matchCandidates.map((candidate): MatchCandidate => ({ ...candidate, neighborhoodId: currentNeighborhoodId(candidate.neighborhoodId) })),
  }))
  console.log(`discount_places.match_candidates (${discountUpdates.length}):`)
  for (const row of discountUpdates) {
    const changed = row.matchCandidates.filter((candidate) => candidate.neighborhoodId in LEGACY_NEIGHBORHOOD_IDS)
    console.log(`  ${row.name}: ${changed.map((candidate) => `${candidate.name} ${arrow(candidate.neighborhoodId)}`).join('; ')}`)
  }

  // Lo que no es un barrio del catálogo ni uno viejo: se avisa para revisarlo a mano, no se toca.
  const unknown = [...placeIds, ...guideIds, ...introIds]
    .map((row) => row.id!)
    .filter((id, index, all) => all.indexOf(id) === index && !(id in NEIGHBORHOOD_NAMES) && !(id in LEGACY_NEIGHBORHOOD_IDS))
  if (unknown.length) console.log(`\nIds que no son de ningún barrio del catálogo (no se tocan): ${unknown.map((id) => JSON.stringify(id)).join(', ')}`)

  const total = placeRows.length + guideRows.length + introRows.length + discountUpdates.length
  if (!total) return console.log('\nNada para corregir.')
  if (!write) return console.log(`\n${total} filas para corregir. Sin --write no se escribió nada.`)

  const updates = [
    ...LEGACY.map((old) => db.update(places).set({ neighborhoodId: LEGACY_NEIGHBORHOOD_IDS[old], updatedAt: places.updatedAt }).where(eq(places.neighborhoodId, old))),
    ...LEGACY.map((old) => db.update(guides).set({ neighborhoodId: LEGACY_NEIGHBORHOOD_IDS[old], updatedAt: guides.updatedAt }).where(eq(guides.neighborhoodId, old))),
    ...LEGACY.map((old) => db.update(guideIntros).set({ neighborhoodId: LEGACY_NEIGHBORHOOD_IDS[old], updatedAt: guideIntros.updatedAt }).where(eq(guideIntros.neighborhoodId, old))),
    ...discountUpdates.map((row) => db.update(discountPlaces).set({ matchCandidates: row.next }).where(eq(discountPlaces.id, row.id))),
  ]
  await db.batch(updates as [(typeof updates)[number], ...(typeof updates)[number][]])
  console.log(`\nListo: ${total} filas corregidas.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
