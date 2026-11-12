// Rearma los textos de búsqueda (keyword_text, embedding_text) de todos los lugares con lo guardado y el catálogo actual
// de shared/tags.ts, para cuando cambian sinónimos o labels. Antes migra los tags y categorías que salieron del catálogo
// (RETIRED_TAGS: sidewalk → outdoor; los demás se eliminan) en categories, tags, signature y manual_overrides; un
// lugar con un conflicto a mano (retired-tags.ts) no se toca y se lista. Por defecto no escribe: lista los que cambian
// con las frases que salen y entran de cada texto, cuántos lugares cambian por cada tag retirado con 10 ejemplos, y el
// costo estimado de los embeddings (sólo los lugares cuyo hash de embedding_text cambia). --apply (o --write) escribe
// las categorías y los tags migrados, los textos que cambian (search_tsv se regenera solo) y esos embeddings, sin updatedAt.
// Uso: yarn search-text:recompute [--apply]
import './env.ts'
import { eq } from 'drizzle-orm'
import { places } from '../db/schema.ts'
import { gatewayEmbedder } from '../places/save.ts'
import { applySearchTextChanges, planTextRefresh, type SearchTextChange, type TextRefreshChange } from '../places/search-text-backfill.ts'
import { isRetiredTagsConflict, planRetiredTags, type RetiredTagsPlan } from '../places/retired-tags.ts'
import { parseManualOverrides, type ManualOverrides } from '../../src/data/manual-overrides.ts'
import { RETIRED_TAGS } from '../../src/data/tags.ts'

const EXAMPLES = 10

async function main() {
  const apply = process.argv.includes('--apply') || process.argv.includes('--write')
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const rows = await db
    .select({
      id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, neighborhoodId: places.neighborhoodId, status: places.status,
      descriptionEs: places.descriptionEs, descriptionEn: places.descriptionEn, locatedIn: places.locatedIn, categories: places.categories,
      tags: places.tags, dietVegan: places.dietVegan, dietVegetarian: places.dietVegetarian, dietGlutenFree: places.dietGlutenFree,
      highlights: places.highlights, dishes: places.dishes, signature: places.signature, style: places.style, manualOverrides: places.manualOverrides,
      keywordText: places.keywordText, embeddingText: places.embeddingText, embeddingTextHash: places.embeddingTextHash,
    })
    .from(places)

  // 1. Tags retirados: con manual_overrides crudo (parseManualOverrides descartaría el diff entero con un id viejo).
  const conflicts: { id: string; name: string; neighborhoodId: string; conflict: string }[] = []
  const retired = new Map<string, RetiredTagsPlan>()
  for (const row of rows) {
    const plan = planRetiredTags(row)
    if (isRetiredTagsConflict(plan)) conflicts.push({ id: row.id, name: row.name, neighborhoodId: row.neighborhoodId, conflict: plan.conflict })
    else if (plan) retired.set(row.id, plan)
  }
  const conflicted = new Set(conflicts.map((entry) => entry.id))

  // 2. Textos con los tags ya migrados y el catálogo actual. Un lugar en conflicto no se toca.
  type Change = SearchTextChange & Partial<Pick<TextRefreshChange, 'keyword' | 'embedding'>>
  const changes = rows.flatMap((row): Change[] => {
    if (conflicted.has(row.id)) return []
    const plan = retired.get(row.id)
    const migrated = { ...row, manualOverrides: parseManualOverrides(plan?.manualOverrides ?? row.manualOverrides), ...(plan ? { categories: plan.categories, tags: plan.tags, signature: plan.signature } : {}) }
    const text = planTextRefresh(migrated)
    if (!plan) return text ? [text] : []
    const values = { categories: plan.categories, tags: plan.tags, signature: plan.signature, manualOverrides: plan.manualOverrides as ManualOverrides }
    return [text
      ? { ...text, values }
      : { id: row.id, googlePlaceId: row.googlePlaceId, name: row.name, skipped: false, values, keywordText: null, embeddingText: null, estimatedEmbeddingUsd: 0 }]
  }).sort((a, b) => a.name.localeCompare(b.name))

  const byId = new Map(rows.map((row) => [row.id, row]))
  const quoted = (parts: string[]) => parts.map((part) => `"${part}"`).join(', ')
  const diff = (label: string, { removed, added }: TextRefreshChange['keyword']) => [
    ...(removed.length ? [`    ${label} −${quoted(removed)}`] : []),
    ...(added.length ? [`    ${label} +${quoted(added)}`] : []),
  ]
  for (const change of changes) {
    if (change.keywordText === null && change.embeddingText === null) continue
    const row = byId.get(change.id)!
    const which = [change.keywordText !== null ? 'keyword_text' : null, change.embeddingText !== null ? 'embedding_text' : null].filter(Boolean).join(' + ')
    console.log(`${change.name} · ${row.neighborhoodId} · ${row.status} · ${which}${change.estimatedEmbeddingUsd ? ` · embedding US$ ${change.estimatedEmbeddingUsd.toFixed(6)}` : ''}`)
    for (const entry of [...diff('keyword', change.keyword ?? { removed: [], added: [] }), ...diff('embedding', change.embedding ?? { removed: [], added: [] })]) console.log(entry)
  }
  // Resumen por frase: qué cambio del catálogo explica cada lugar.
  const byFragment = new Map<string, number>()
  const bump = (key: string) => byFragment.set(key, (byFragment.get(key) ?? 0) + 1)
  for (const change of changes) {
    for (const part of change.keyword?.removed ?? []) bump(`keyword −"${part}"`)
    for (const part of change.keyword?.added ?? []) bump(`keyword +"${part}"`)
    for (const part of change.embedding?.removed ?? []) bump(`embedding −"${part}"`)
    for (const part of change.embedding?.added ?? []) bump(`embedding +"${part}"`)
  }
  console.log('\nPor frase:')
  for (const [fragment, count] of [...byFragment].sort((a, b) => b[1] - a[1])) console.log(`  ${count} · ${fragment}`)

  // Tags retirados: por cada uno, cuántos lugares cambian en la columna y en manual_overrides, con ejemplos.
  console.log('\nTags retirados:')
  for (const [tag, replacement] of Object.entries(RETIRED_TAGS)) {
    const affected = [...retired].flatMap(([id, plan]) => plan.effects.filter((effect) => effect.tag === tag).map((effect) => ({ row: byId.get(id)!, plan, effect })))
    const column = affected.filter(({ effect }) => effect.column)
    const overrides = affected.filter(({ effect }) => effect.overrides)
    const gains = replacement ? column.filter(({ row }) => !row.tags.includes(replacement)) : []
    console.log(`  ${tag} → ${replacement ?? 'se elimina'}: ${column.length} lugares con el tag${replacement ? ` (${gains.length} ganan ${replacement}, ${column.length - gains.length} ya lo tenían)` : ''}, ${overrides.length} con el tag en manual_overrides`)
    // Primero los que tienen el tag en manual_overrides: son los menos y los que más conviene mirar.
    for (const { row, plan, effect } of [...overrides, ...affected.filter(({ effect }) => !effect.overrides)].slice(0, EXAMPLES)) {
      const raw = (row.manualOverrides ?? {}) as { tags?: { add?: string[]; remove?: string[] } }
      const next = plan.manualOverrides as { tags?: { add?: string[]; remove?: string[] } }
      const overrideText = effect.overrides && raw.tags ? ` · overrides add [${raw.tags.add?.join(', ')}] → [${next.tags?.add?.join(', ')}], remove [${raw.tags.remove?.join(', ')}] → [${next.tags?.remove?.join(', ')}]` : ''
      const tagsText = effect.column ? ` · tags −${tag}${replacement && !row.tags.includes(replacement) ? ` +${replacement}` : ''}` : ''
      console.log(`    ${row.name} · ${row.neighborhoodId} · ${row.status}${tagsText}${overrideText}`)
    }
    if (affected.length > EXAMPLES) console.log(`    … y ${affected.length - EXAMPLES} más`)
  }
  console.log(`\nConflictos a mano, no se tocan (${conflicts.length}):`)
  for (const entry of conflicts) console.log(`  ${entry.name} · ${entry.neighborhoodId} · ${entry.conflict}`)

  const texts = changes.filter((change) => change.keywordText !== null || change.embeddingText !== null)
  const embeds = changes.filter((change) => change.embeddingText !== null && change.embed !== false)
  const total = changes.reduce((sum, change) => sum + change.estimatedEmbeddingUsd, 0)
  console.log(`\n${changes.length} de ${rows.length} lugares cambian: ${retired.size} por tags retirados, ${texts.length} de textos (${embeds.length} con embedding nuevo). Embeddings: US$ ${total.toFixed(6)} aprox.`)
  if (!apply) {
    console.log('Sin escribir: --apply escribe las categorías y los tags migrados, los textos de búsqueda y los embeddings que cambian.')
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
