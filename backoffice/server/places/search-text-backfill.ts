import { createHash } from 'node:crypto'
import { buildEmbeddingText, buildKeywordText, isOccasionTag, type OccasionTag, type StyleId } from '../../src/data/tags.ts'
import type { TagEvidence } from '../../src/types/places.ts'
import { searchTextInput } from '../providers/place-extraction-service.ts'
import type { Place } from '../db/schema.ts'
import { EMBEDDING_MODEL, type Embedder } from './save.ts'

// text-embedding-3-small: US$0,02 por millón de tokens. Los tokens se estiman como caracteres / 4.
const EMBEDDING_USD_PER_TOKEN = 0.02 / 1_000_000

/** Lo que el replay lee de cada lugar guardado: el style, los tags y lo que entra en los textos de búsqueda. */
export type SearchTextRow = Pick<Place,
  'id' | 'googlePlaceId' | 'name' | 'neighborhoodId' | 'descriptionEs' | 'descriptionEn' | 'locatedIn' | 'categories' | 'tags' |
  'dietVegan' | 'dietVegetarian' | 'dietGlutenFree' | 'highlights' | 'dishes' | 'signature' | 'style' | 'manualOverrides'>

export type StyleBasis = NonNullable<TagEvidence['basis']>

/** Lo que se escribe del lugar además de los textos: el style o los tags. */
export type SearchTextValues = Partial<Pick<Place, 'style' | 'tags'>>

/** Cambio de un lugar guardado que regenera sus textos de búsqueda y el embedding. */
export type SearchTextChange = {
  id: string
  googlePlaceId: string | null
  name: string
  /** El campo tiene override manual: no se escribe nada. */
  skipped: boolean
  values: SearchTextValues
  /** Textos nuevos (null si el override manual del campo lo impide). */
  keywordText: string | null
  embeddingText: string | null
  estimatedEmbeddingUsd: number
}

export type StyleChange = SearchTextChange & { before: StyleId | null; after: StyleId; basis: StyleBasis | null }

export type MomentsChange = SearchTextChange & { before: OccasionTag[]; after: OccasionTag[]; added: OccasionTag[]; removed: OccasionTag[] }

/** Como savePlaces: un embedding o su texto con override manual no se regenera. */
function keepsEmbedding(row: SearchTextRow) {
  return row.manualOverrides.includes('embedding_text') || row.manualOverrides.includes('embedding')
}

/** Los textos de búsqueda con los datos guardados del lugar y lo que cambia (style o tags). */
function searchTexts(row: SearchTextRow, values: SearchTextValues, skipped: boolean) {
  const input = searchTextInput({
    name: row.name,
    neighborhoodId: row.neighborhoodId,
    description: { es: row.descriptionEs ?? '', en: row.descriptionEn ?? '' },
    locatedIn: row.locatedIn,
    categories: row.categories,
    tags: values.tags ?? row.tags,
    dietary: { vegan: row.dietVegan, vegetarian: row.dietVegetarian, glutenFree: row.dietGlutenFree },
    highlights: row.highlights,
    dishes: row.dishes,
    signature: row.signature,
    style: (values.style ?? row.style) as StyleId | null,
  })
  const embeddingText = skipped || keepsEmbedding(row) ? null : buildEmbeddingText(input)
  return {
    keywordText: skipped || row.manualOverrides.includes('keyword_text') ? null : buildKeywordText(input),
    embeddingText,
    estimatedEmbeddingUsd: embeddingText ? Math.ceil(embeddingText.length / 4) * EMBEDDING_USD_PER_TOKEN : 0,
  }
}

/**
 * Cambio de style de un lugar guardado según el replay, o null si no cambia. Los textos de búsqueda se arman con
 * los datos guardados del lugar y el style nuevo: sólo cambia la parte del estilo.
 */
export function planStyleChange(row: SearchTextRow, replayed: { style?: StyleId | null; tagEvidence?: TagEvidence[] }): StyleChange | null {
  if (!replayed.style || replayed.style === row.style) return null
  const basis = replayed.tagEvidence?.find((evidence) => evidence.tag === replayed.style)?.basis ?? null
  const skipped = row.manualOverrides.includes('style')
  const values = { style: replayed.style }
  return {
    id: row.id,
    googlePlaceId: row.googlePlaceId,
    name: row.name,
    before: row.style as StyleId | null,
    after: replayed.style,
    basis,
    skipped,
    values,
    ...searchTexts(row, values, skipped),
  }
}

/**
 * Cambio de momentos de un lugar guardado según el replay, o null si son los mismos. Sólo se reemplazan los tags de
 * momento (groups, date…); los demás quedan como están guardados.
 */
export function planMomentsChange(row: SearchTextRow, replayed: { tags: string[] }): MomentsChange | null {
  const before = row.tags.filter(isOccasionTag)
  const after = replayed.tags.filter(isOccasionTag)
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  if (added.length === 0 && removed.length === 0) return null
  const skipped = row.manualOverrides.includes('tags')
  const values = { tags: [...row.tags.filter((id) => !isOccasionTag(id)), ...after] }
  return { id: row.id, googlePlaceId: row.googlePlaceId, name: row.name, before, after, added, removed, skipped, values, ...searchTexts(row, values, skipped) }
}

export type SearchTextWrite = SearchTextValues & Partial<Pick<Place, 'keywordText' | 'embeddingText' | 'embedding' | 'embeddingModel' | 'embeddingTextHash' | 'embeddedAt'>>

/**
 * Escribe el style o los tags, keyword_text, embedding_text y el embedding de los cambios (search_tsv sale de
 * keyword_text). Si el embedding falla, se escriben igual los valores y los textos y vuelve el error.
 */
export async function applySearchTextChanges(
  changes: SearchTextChange[],
  deps: { write(id: string, values: SearchTextWrite): Promise<void>; embed: Embedder; now?: () => Date },
): Promise<{ written: number; embedError: string | null }> {
  const pending = changes.filter((change) => !change.skipped)
  const toEmbed = pending.filter((change) => change.embeddingText !== null)
  let vectors: number[][] = []
  let embedError: string | null = null
  if (toEmbed.length > 0) {
    try {
      vectors = await deps.embed(toEmbed.map((change) => change.embeddingText!))
    } catch (error) {
      embedError = `No se pudieron generar los embeddings: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  const embeddedAt = deps.now?.() ?? new Date()
  for (const change of pending) {
    const vector = vectors[toEmbed.indexOf(change)]
    await deps.write(change.id, {
      ...change.values,
      ...(change.keywordText !== null ? { keywordText: change.keywordText } : {}),
      ...(change.embeddingText !== null ? { embeddingText: change.embeddingText } : {}),
      ...(vector ? {
        embedding: vector,
        embeddingModel: EMBEDDING_MODEL,
        embeddingTextHash: createHash('sha256').update(change.embeddingText!).digest('hex'),
        embeddedAt,
      } : {}),
    })
  }
  return { written: pending.length, embedError }
}
