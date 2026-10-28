// Rearma los textos de búsqueda (keyword_text, embedding_text) de todos los lugares con lo guardado y el catálogo actual
// de shared/tags.ts, para cuando cambian sinónimos o labels. No cambia ningún dato del lugar. Por defecto no escribe:
// lista los que cambian con las frases que salen y entran de cada texto, y el costo estimado de los embeddings (sólo
// los lugares cuyo embedding_text cambia). --write escribe los textos que cambian (search_tsv se regenera solo) y el
// embedding de los que cambian de embedding_text, sin updatedAt.
// Uso: yarn search-text:recompute [--write]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { gatewayEmbedder } from '../places/save.ts'
import { applySearchTextChanges, planTextRefresh, type TextRefreshChange } from '../places/search-text-backfill.ts'
import { parseManualOverrides } from '../../src/data/manual-overrides.ts'

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
      keywordText: places.keywordText, embeddingText: places.embeddingText,
    })
    .from(places))
    .map((row) => ({ ...row, manualOverrides: parseManualOverrides(row.manualOverrides) }))

  const changes = rows.flatMap((row) => planTextRefresh(row) ?? []).sort((a, b) => a.name.localeCompare(b.name))
  const quoted = (parts: string[]) => parts.map((part) => `"${part}"`).join(', ')
  const diff = (label: string, { removed, added }: TextRefreshChange['keyword']) => [
    ...(removed.length ? [`    ${label} −${quoted(removed)}`] : []),
    ...(added.length ? [`    ${label} +${quoted(added)}`] : []),
  ]
  for (const change of changes) {
    const row = rows.find((entry) => entry.id === change.id)!
    const which = [change.keywordText !== null ? 'keyword_text' : null, change.embeddingText !== null ? 'embedding_text' : null].filter(Boolean).join(' + ')
    console.log(`${change.name} · ${row.neighborhoodId} · ${row.status} · ${which}${change.estimatedEmbeddingUsd ? ` · embedding US$ ${change.estimatedEmbeddingUsd.toFixed(6)}` : ''}`)
    for (const entry of [...diff('keyword', change.keyword), ...diff('embedding', change.embedding)]) console.log(entry)
  }
  // Resumen por frase: qué cambio del catálogo explica cada lugar.
  const byFragment = new Map<string, number>()
  for (const change of changes) {
    for (const part of change.keyword.removed) byFragment.set(`keyword −"${part}"`, (byFragment.get(`keyword −"${part}"`) ?? 0) + 1)
    for (const part of change.keyword.added) byFragment.set(`keyword +"${part}"`, (byFragment.get(`keyword +"${part}"`) ?? 0) + 1)
    for (const part of change.embedding.removed) byFragment.set(`embedding −"${part}"`, (byFragment.get(`embedding −"${part}"`) ?? 0) + 1)
    for (const part of change.embedding.added) byFragment.set(`embedding +"${part}"`, (byFragment.get(`embedding +"${part}"`) ?? 0) + 1)
  }
  console.log('\nPor frase:')
  for (const [fragment, count] of [...byFragment].sort((a, b) => b[1] - a[1])) console.log(`  ${count} · ${fragment}`)
  const embeds = changes.filter((change) => change.embeddingText !== null)
  const total = changes.reduce((sum, change) => sum + change.estimatedEmbeddingUsd, 0)
  console.log(`\n${changes.length} de ${rows.length} lugares cambian (${embeds.length} con embedding nuevo). Embeddings: US$ ${total.toFixed(6)} aprox.`)
  if (!write) {
    console.log('Sin escribir: --write escribe los textos de búsqueda y los embeddings que cambian.')
    return
  }
  const result = await applySearchTextChanges(changes, {
    embed: gatewayEmbedder,
    write: async (id, values) => {
      await db.update(places).set({ ...values, updatedAt: places.updatedAt }).where(eq(places.id, id))
    },
  })
  console.log(`Escritos: ${result.written}.${result.embedError ? ` ${result.embedError}` : ''}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
