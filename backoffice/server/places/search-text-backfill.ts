import { createHash } from 'node:crypto'
import { isOccasionTag, type OccasionTag, type StyleId } from '../../src/data/tags.ts'
import type { TagEvidence } from '../../src/types/places.ts'
import type { ManualOverrides } from '../../src/data/manual-overrides.ts'
import type { Place } from '../db/schema.ts'
import { EMBEDDING_MODEL, type Embedder } from './save.ts'
import { applyOverrides, placeSearchTexts } from './manual-overrides.ts'

// text-embedding-3-small: US$0,02 por millón de tokens. Los tokens se estiman como caracteres / 4.
const EMBEDDING_USD_PER_TOKEN = 0.02 / 1_000_000

/** Costo estimado de embeber un texto. */
export const estimatedEmbeddingUsd = (text: string) => Math.ceil(text.length / 4) * EMBEDDING_USD_PER_TOKEN

/** Lo que el replay lee de cada lugar guardado: el style, los tags y lo que entra en los textos de búsqueda. */
export type SearchTextRow = Pick<Place,
  'id' | 'googlePlaceId' | 'name' | 'neighborhoodId' | 'descriptionEs' | 'descriptionEn' | 'locatedIn' | 'categories' | 'tags' |
  'dietVegan' | 'dietVegetarian' | 'dietGlutenFree' | 'highlights' | 'dishes' | 'signature' | 'style'> & { manualOverrides: ManualOverrides }

export type StyleBasis = NonNullable<TagEvidence['basis']>

/**
 * Lo que se escribe del lugar además de los textos: el style o los tags (y signature, si pierde un tag sacado), o
 * categories y manual_overrides en la migración de tags retirados (retired-tags.ts).
 */
export type SearchTextValues = Partial<Pick<Place, 'style' | 'categories' | 'tags' | 'signature' | 'manualOverrides'>>

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
  /** false: se escribe embedding_text pero no se pide el embedding (el hash guardado ya es el del texto nuevo). */
  embed?: boolean
}

export type StyleChange = SearchTextChange & { before: StyleId | null; after: StyleId; basis: StyleBasis | null }

export type TagsChange<T extends string = string> = SearchTextChange & { before: T[]; after: T[]; added: T[]; removed: T[] }

export type MomentsChange = TagsChange<OccasionTag>

/** Los textos de búsqueda con los datos guardados del lugar y lo que cambia (style o tags). */
function searchTexts(row: SearchTextRow, values: SearchTextValues, skipped: boolean) {
  if (skipped) return { keywordText: null, embeddingText: null, estimatedEmbeddingUsd: 0 }
  const { keywordText, embeddingText } = placeSearchTexts({ ...row, ...values })
  return { keywordText, embeddingText, estimatedEmbeddingUsd: estimatedEmbeddingUsd(embeddingText) }
}

/**
 * Cambio de style de un lugar guardado según el replay, o null si no cambia. Los textos de búsqueda se arman con
 * los datos guardados del lugar y el style nuevo: sólo cambia la parte del estilo.
 */
export function planStyleChange(row: SearchTextRow, replayed: { style?: StyleId | null; tagEvidence?: TagEvidence[] }): StyleChange | null {
  if (!replayed.style || replayed.style === row.style) return null
  const basis = replayed.tagEvidence?.find((evidence) => evidence.tag === replayed.style)?.basis ?? null
  const skipped = Object.hasOwn(row.manualOverrides, 'style')
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
 * Cambio de algunos tags de un lugar guardado según el replay, o null si son los mismos. Sólo se reemplazan los tags
 * que cumplen `only`; los demás quedan como están guardados. Los tags editados a mano se respetan: uno sacado a mano
 * no vuelve y uno agregado a mano queda, pero los demás tags nuevos del replay sí entran.
 */
export function planTagsChange<T extends string>(row: SearchTextRow, replayed: { tags: string[] }, only: (id: string) => id is T): TagsChange<T> | null {
  const auto = [...row.tags.filter((id) => !only(id)), ...replayed.tags.filter(only)]
  const { tags } = applyOverrides({ tags: auto }, row.manualOverrides)
  const before = row.tags.filter(only)
  const after = tags!.filter(only)
  const added = after.filter((id) => !before.includes(id))
  const removed = before.filter((id) => !after.includes(id))
  if (added.length === 0 && removed.length === 0) return null
  // signature es un subconjunto de tags: un tag que sale, sale también de signature.
  const signature = row.signature.filter((id) => tags!.includes(id))
  const values = signature.length === row.signature.length ? { tags: tags! } : { tags: tags!, signature }
  return { id: row.id, googlePlaceId: row.googlePlaceId, name: row.name, before, after, added, removed, skipped: false, values, ...searchTexts(row, values, false) }
}

/** Cambio de los momentos (groups, date…) de un lugar guardado según el replay; los demás tags quedan como están. */
export function planMomentsChange(row: SearchTextRow, replayed: { tags: string[] }): MomentsChange | null {
  return planTagsChange(row, replayed, isOccasionTag)
}

/** Cambio de los textos de búsqueda de un lugar con el catálogo actual (sinónimos o labels de tags.ts), sin tocar sus datos. */
export type TextRefreshChange = SearchTextChange & {
  before: { keywordText: string | null; embeddingText: string | null }
  /** Frases (separadas por ". ") que salen y entran de cada texto. */
  keyword: { removed: string[]; added: string[] }
  embedding: { removed: string[]; added: string[] }
}

const fragments = (text: string | null) => (text ?? '').split('. ').filter(Boolean)
const fragmentDiff = (before: string | null, after: string) => {
  const [old, next] = [fragments(before), fragments(after)]
  return { removed: old.filter((part) => !next.includes(part)), added: next.filter((part) => !old.includes(part)) }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * Textos de búsqueda de un lugar guardado rearmados con lo guardado y el catálogo actual, o null si son los mismos. Un
 * texto que no cambia va en null: no se escribe y, si es el del embedding, no se paga. search_tsv sale de keyword_text.
 * Con embeddingTextHash, el embedding se pide sólo si el hash del texto nuevo es otro (como savePlaces).
 */
export function planTextRefresh(row: SearchTextRow & { keywordText: string | null; embeddingText: string | null; embeddingTextHash?: string | null }): TextRefreshChange | null {
  const { keywordText, embeddingText } = placeSearchTexts(row)
  const keywordChanged = keywordText !== row.keywordText
  const embeddingChanged = embeddingText !== row.embeddingText
  if (!keywordChanged && !embeddingChanged) return null
  const embed = embeddingChanged && (row.embeddingTextHash === undefined || row.embeddingTextHash !== sha256(embeddingText))
  return {
    id: row.id,
    googlePlaceId: row.googlePlaceId,
    name: row.name,
    skipped: false,
    values: {},
    keywordText: keywordChanged ? keywordText : null,
    embeddingText: embeddingChanged ? embeddingText : null,
    estimatedEmbeddingUsd: embed ? estimatedEmbeddingUsd(embeddingText) : 0,
    embed,
    before: { keywordText: row.keywordText, embeddingText: row.embeddingText },
    keyword: keywordChanged ? fragmentDiff(row.keywordText, keywordText) : { removed: [], added: [] },
    embedding: embeddingChanged ? fragmentDiff(row.embeddingText, embeddingText) : { removed: [], added: [] },
  }
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
  const toEmbed = pending.filter((change) => change.embeddingText !== null && change.embed !== false)
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
        embeddingTextHash: sha256(change.embeddingText!),
        embeddedAt,
      } : {}),
    })
  }
  return { written: pending.length, embedError }
}
