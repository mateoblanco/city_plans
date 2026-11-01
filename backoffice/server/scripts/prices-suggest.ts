// Propone un precio para cada lugar guardado con la carta, frases y tags de su snapshot (cache/extractions) y sus
// tags en la base (server/places/price-suggestion.ts). No llama a ninguna API.
// Por defecto no escribe: lista cuántos reciben sugerencia de cada nivel, cuántos difieren del precio actual y
// ejemplos. --write reemplaza la tabla price_suggestions (no toca places.price: se acepta desde Lugares); una sugerencia
// descartada en Lugares sigue descartada si vuelve a salir el mismo precio.
// Uso: yarn prices:suggest [--write] [--examples <n>]
import './env.ts'
import { isNotNull } from 'drizzle-orm'
import { places, priceSuggestions } from '../db/schema.ts'
import { readSnapshots } from '../providers/extraction-snapshots.ts'
import { suggestPrice, type PriceSuggestion } from '../places/price-suggestion.ts'
import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'
import { PRICE_LABELS as LABELS } from '../../src/data/manual-overrides.ts'

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}


type Row = { id: string; name: string; neighborhoodId: string; price: keyof typeof LABELS; suggestion: PriceSuggestion }

function printGroup(title: string, rows: Row[], examples: number) {
  console.log(`\n${title} (${rows.length}):`)
  for (const row of rows.slice(0, examples)) {
    const { suggestion } = row
    console.log(`  ${row.name} (${neighborhoodDisplayName(row.neighborhoodId) ?? row.neighborhoodId}) · ${LABELS[row.price]} → ${LABELS[suggestion.price]} · ${suggestion.signal}`)
    console.log(`    ${suggestion.reason}`)
    if (suggestion.snippet) console.log(`    ${suggestion.snippet}`)
  }
}

async function main() {
  const write = process.argv.includes('--write')
  const examples = Number(argValue('--examples') ?? 10)
  if (!process.env.DATABASE_URL) throw new Error('Falta configurar DATABASE_URL en .env.local.')
  const { db } = await import('../db/index.ts')
  const [rows, snapshots] = await Promise.all([
    db.select({
      id: places.id, name: places.name, neighborhoodId: places.neighborhoodId, googlePlaceId: places.googlePlaceId, price: places.price,
      iconCategory: places.iconCategory, categories: places.categories, tags: places.tags, style: places.style,
    }).from(places).orderBy(places.name),
    readSnapshots(),
  ])
  const sourcesById = new Map(snapshots.map((snapshot) => [snapshot.googlePlaceId, snapshot.sources]))

  const suggested: Row[] = []
  let withoutSnapshot = 0
  for (const row of rows) {
    const sources = row.googlePlaceId ? sourcesById.get(row.googlePlaceId) ?? null : null
    if (!sources) withoutSnapshot++
    const suggestion = suggestPrice(row, sources)
    if (suggestion) suggested.push({ ...row, suggestion })
  }
  const differs = suggested.filter((row) => row.price !== row.suggestion.price)
  const bySignal = (list: Row[]) => (['menu', 'phrase', 'tags'] as const).map((signal) => `${signal} ${list.filter((row) => row.suggestion.signal === signal).length}`).join(', ')
  const byTier = (tier: string) => suggested.filter((row) => row.suggestion.price === tier)

  console.log(`${rows.length} lugares · ${snapshots.length} snapshots · ${withoutSnapshot} sin snapshot (sólo tags).`)
  console.log(`Con sugerencia: ${suggested.length} (${bySignal(suggested)}): low ${byTier('low').length}, moderate ${byTier('moderate').length}, high ${byTier('high').length}.`)
  console.log(`Difieren del precio actual o es unknown (lo que muestra Lugares): ${differs.length} (${bySignal(differs)}).`)

  const unknown = differs.filter((row) => row.price === 'unknown')
  const toLow = differs.filter((row) => row.price !== 'unknown' && row.suggestion.price === 'low')
  const toHigh = differs.filter((row) => row.price !== 'unknown' && row.suggestion.price === 'high')
  const highToModerate = differs.filter((row) => row.price === 'high' && row.suggestion.price === 'moderate')
  const highToLow = differs.filter((row) => row.price === 'high' && row.suggestion.price === 'low')
  const otherToModerate = differs.filter((row) => row.price !== 'unknown' && row.price !== 'high' && row.suggestion.price === 'moderate')
  const highTotal = rows.filter((row) => row.price === 'high').length
  console.log(`\nDe ${highTotal} high: ${highToModerate.length} pasarían a moderate y ${highToLow.length} a low.`)

  printGroup('Sugerencia low (precio actual distinto)', toLow, examples)
  printGroup('Sugerencia high (precio actual distinto)', toHigh, examples)
  printGroup('unknown → alguna sugerencia', unknown, examples)
  printGroup('high → moderate', highToModerate, examples)
  printGroup('high → low', highToLow, examples)
  if (otherToModerate.length) printGroup('low → moderate', otherToModerate, examples)

  if (!write) {
    console.log(`\nSin escribir: --write reemplaza price_suggestions con las ${suggested.length} sugerencias (Lugares muestra las ${differs.length} que difieren).`)
    return
  }
  const computedAt = new Date()
  const dismissed = new Map((await db.select({ placeId: priceSuggestions.placeId, price: priceSuggestions.price, dismissedAt: priceSuggestions.dismissedAt })
    .from(priceSuggestions).where(isNotNull(priceSuggestions.dismissedAt)))
    .map((row) => [row.placeId, row]))
  const values = suggested.map((row) => {
    const previous = dismissed.get(row.id)
    return { placeId: row.id, ...row.suggestion, computedAt, dismissedAt: previous?.price === row.suggestion.price ? previous.dismissedAt : null }
  })
  // Todo en un batch (una transacción): la tabla nunca queda a medio llenar.
  const inserts = []
  for (let index = 0; index < values.length; index += 200) inserts.push(db.insert(priceSuggestions).values(values.slice(index, index + 200)))
  await db.batch([db.delete(priceSuggestions), ...inserts])
  console.log(`\nEscritas: ${values.length} (${values.filter((value) => value.dismissedAt).length} siguen descartadas).`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
