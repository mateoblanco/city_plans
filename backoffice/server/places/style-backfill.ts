import { createHash } from 'node:crypto'
import { buildEmbeddingText, buildKeywordText, type StyleId } from '../../src/data/tags.ts'
import type { TagEvidence } from '../../src/types/places.ts'
import { searchTextInput } from '../providers/place-extraction-service.ts'
import type { Place } from '../db/schema.ts'
import { EMBEDDING_MODEL, type Embedder } from './save.ts'

// text-embedding-3-small: US$0,02 por millón de tokens. Los tokens se estiman como caracteres / 4.
const EMBEDDING_USD_PER_TOKEN = 0.02 / 1_000_000

/** Lo que el replay de style lee de cada lugar guardado: el style y lo que entra en los textos de búsqueda. */
export type StyleRow = Pick<Place,
  'id' | 'googlePlaceId' | 'name' | 'neighborhoodId' | 'descriptionEs' | 'descriptionEn' | 'locatedIn' | 'categories' | 'tags' |
  'dietVegan' | 'dietVegetarian' | 'dietGlutenFree' | 'highlights' | 'dishes' | 'signature' | 'style' | 'manualOverrides'>

export type StyleBasis = NonNullable<TagEvidence['basis']>

export type StyleChange = {
  id: string
  googlePlaceId: string | null
  name: string
  before: StyleId | null
  after: StyleId
  basis: StyleBasis | null
  /** style tiene override manual: no se escribe nada. */
  skipped: boolean
  /** Textos nuevos (null si el override manual del campo lo impide). */
  keywordText: string | null
  embeddingText: string | null
  estimatedEmbeddingUsd: number
}

/**
 * Cambio de style de un lugar guardado según el replay, o null si no cambia. Los textos de búsqueda se arman con
 * los datos guardados del lugar y el style nuevo: sólo cambia la parte del estilo.
 */
export function planStyleChange(row: StyleRow, replayed: { style?: StyleId | null; tagEvidence?: TagEvidence[] }): StyleChange | null {
  if (!replayed.style || replayed.style === row.style) return null
  const basis = replayed.tagEvidence?.find((evidence) => evidence.tag === replayed.style)?.basis ?? null
  const skipped = row.manualOverrides.includes('style')
  const input = searchTextInput({
    name: row.name,
    neighborhoodId: row.neighborhoodId,
    description: { es: row.descriptionEs ?? '', en: row.descriptionEn ?? '' },
    locatedIn: row.locatedIn,
    categories: row.categories,
    tags: row.tags,
    dietary: { vegan: row.dietVegan, vegetarian: row.dietVegetarian, glutenFree: row.dietGlutenFree },
    highlights: row.highlights,
    dishes: row.dishes,
    signature: row.signature,
    style: replayed.style,
  })
  const embeddingText = skipped || keepsEmbedding(row) ? null : buildEmbeddingText(input)
  return {
    id: row.id,
    googlePlaceId: row.googlePlaceId,
    name: row.name,
    before: row.style,
    after: replayed.style,
    basis,
    skipped,
    keywordText: skipped || row.manualOverrides.includes('keyword_text') ? null : buildKeywordText(input),
    embeddingText,
    estimatedEmbeddingUsd: embeddingText ? Math.ceil(embeddingText.length / 4) * EMBEDDING_USD_PER_TOKEN : 0,
  }
}

/** Como savePlaces: un embedding o su texto con override manual no se regenera. */
function keepsEmbedding(row: StyleRow) {
  return row.manualOverrides.includes('embedding_text') || row.manualOverrides.includes('embedding')
}

export type StyleWrite = Partial<Pick<Place, 'style' | 'keywordText' | 'embeddingText' | 'embedding' | 'embeddingModel' | 'embeddingTextHash' | 'embeddedAt'>>

/**
 * Escribe style, keyword_text, embedding_text y el embedding de los cambios (search_tsv sale de keyword_text).
 * Si el embedding falla, se escriben igual el style y los textos y vuelve el error.
 */
export async function applyStyleChanges(
  changes: StyleChange[],
  deps: { write(id: string, values: StyleWrite): Promise<void>; embed: Embedder; now?: () => Date },
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
      style: change.after,
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
