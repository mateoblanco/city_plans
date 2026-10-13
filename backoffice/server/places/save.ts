import { createHash } from 'node:crypto'
import { embedMany } from 'ai'
import { getTableColumns, inArray, like, or, eq } from 'drizzle-orm'
import pMap from 'p-map'
import { PlaceDraft } from '../../src/data/place-schema.ts'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from '../db/schema.ts'
import { places, type NewPlace } from '../db/schema.ts'
import { MISSING_NAME, toRow } from './to-row.ts'

export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const WRITE_CONCURRENCY = 5

export type SavePlaceResult = {
  googlePlaceId: string
  id: string | null
  action: 'created' | 'updated' | 'skipped'
  embedded: boolean
  error?: string
}

export type ExistingPlace = { id: string; googlePlaceId: string; embeddingTextHash: string | null; manualOverrides: string[] }

/** Lo único que savePlaces necesita de la base; los tests usan un fake en memoria. */
export type PlacesStore = {
  findByGooglePlaceIds(ids: string[]): Promise<ExistingPlace[]>
  /** Slugs iguales a base o de la forma base-N. */
  slugsStartingWith(base: string): Promise<string[]>
  insert(row: NewPlace): Promise<string>
  update(id: string, values: Partial<NewPlace>): Promise<void>
}

export type Embedder = (texts: string[]) => Promise<number[][]>

export type PlacesSaver = {
  save(results: unknown[]): Promise<SavePlaceResult[]>
  existing(ids: string[]): Promise<string[]>
}

// Por el AI Gateway, con la misma AI_GATEWAY_API_KEY que el pipeline.
export const gatewayEmbedder: Embedder = async (values) => (await embedMany({ model: EMBEDDING_MODEL, values })).embeddings

// manualOverrides guarda nombres de columna SQL (diet_vegan); el update usa las keys de Drizzle (dietVegan).
const KEY_BY_COLUMN = new Map(Object.entries(getTableColumns(places)).map(([key, column]) => [column.name, key]))
// Una extracción nunca pisa la identidad ni la curaduría del lugar.
const NEVER_UPDATED = new Set(['id', 'googlePlaceId', 'slug', 'status', 'createdAt'])

export function slugify(name: string) {
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'lugar'
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

type Candidate = { googlePlaceId: string; place: ValidDraft & { neighborhoodId: string } }
type ValidDraft = import('zod').infer<typeof PlaceDraft>

/** Lee un resultado del pipeline: un place válido para guardar, un skip con motivo, o null si se ignora. */
function candidateFrom(result: unknown): Candidate | SavePlaceResult | null {
  const value = (typeof result === 'object' && result !== null ? result : {}) as { status?: unknown; place?: unknown; target?: { googlePlaceId?: unknown } }
  if (value.status === 'error') return null
  const skip = (googlePlaceId: unknown, error: string): SavePlaceResult =>
    ({ googlePlaceId: typeof googlePlaceId === 'string' ? googlePlaceId : '', id: null, action: 'skipped', embedded: false, error })
  if (value.status === 'no_sources') return skip(value.target?.googlePlaceId, 'Sin fuentes: no hay datos para guardar')
  if (value.status !== 'ok') return skip((value.place as { googlePlaceId?: unknown } | undefined)?.googlePlaceId, 'Resultado sin status ok')
  const parsed = PlaceDraft.safeParse(value.place)
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))].slice(0, 5).join(', ')
    return skip((value.place as { googlePlaceId?: unknown } | undefined)?.googlePlaceId, `Datos inválidos: ${fields}`)
  }
  const { neighborhoodId } = parsed.data
  if (!parsed.data.name.trim()) return skip(parsed.data.googlePlaceId, MISSING_NAME)
  if (!neighborhoodId) return skip(parsed.data.googlePlaceId, 'Sin barrio')
  return { googlePlaceId: parsed.data.googlePlaceId, place: { ...parsed.data, neighborhoodId } }
}

/**
 * Guarda los resultados del pipeline en `places`. Los status "error" se ignoran; cada lugar se
 * escribe por separado, así que una falla no corta el resto. Un embedding fallido no impide guardar.
 */
export async function savePlaces(results: unknown[], deps: { store: PlacesStore; embed?: Embedder }): Promise<SavePlaceResult[]> {
  const { store, embed = gatewayEmbedder } = deps
  const entries = results.map(candidateFrom).filter((entry): entry is Candidate | SavePlaceResult => entry !== null)
  // Si un googlePlaceId viene repetido, queda el último.
  const lastIndex = new Map(entries.map((entry, index) => [entry.googlePlaceId, index]))
  const unique = entries.filter((entry, index) => !entry.googlePlaceId || lastIndex.get(entry.googlePlaceId) === index)
  const candidates = unique.filter((entry): entry is Candidate => 'place' in entry)

  const existing = new Map(candidates.length > 0
    ? (await store.findByGooglePlaceIds(candidates.map((entry) => entry.googlePlaceId))).map((row) => [row.googlePlaceId, row])
    : [])

  // Slugs de los nuevos: se reservan en orden, contando los de la base y los del mismo lote.
  const slugs = new Map<string, string>()
  const usedInBatch = new Set<string>()
  for (const { googlePlaceId, place } of candidates) {
    if (existing.has(googlePlaceId)) continue
    const base = slugify(place.name)
    const taken = new Set([...await store.slugsStartingWith(base), ...usedInBatch])
    let slug = base
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`
    usedInBatch.add(slug)
    slugs.set(googlePlaceId, slug)
  }

  // Embeddings: sólo los que cambiaron de texto, todos en un único llamado.
  const hashes = new Map(candidates.map(({ googlePlaceId, place }) => [googlePlaceId, sha256(place.embeddingText)]))
  const toEmbed = candidates.filter(({ googlePlaceId }) => {
    const row = existing.get(googlePlaceId)
    if (row?.manualOverrides.includes('embedding_text') || row?.manualOverrides.includes('embedding')) return false
    return row?.embeddingTextHash !== hashes.get(googlePlaceId)
  })
  const embeddings = new Map<string, number[]>()
  let embedError: string | null = null
  if (toEmbed.length > 0) {
    try {
      const vectors = await embed(toEmbed.map(({ place }) => place.embeddingText))
      toEmbed.forEach(({ googlePlaceId }, index) => { if (vectors[index]) embeddings.set(googlePlaceId, vectors[index]) })
    } catch (error) {
      embedError = `No se pudieron generar los embeddings: ${message(error)}`
    }
  }
  const embeddedAt = new Date()

  const written = new Map<string, SavePlaceResult>()
  await pMap(candidates, async ({ googlePlaceId, place }) => {
    const embedding = embeddings.get(googlePlaceId)
    const failedEmbedding = embedError && toEmbed.some((entry) => entry.googlePlaceId === googlePlaceId) ? { error: embedError } : {}
    const current = existing.get(googlePlaceId)
    try {
      // Dentro del try: si toRow rechaza el lugar, falla sólo ese y no el lote.
      const row: Omit<NewPlace, 'slug'> = {
        ...toRow(place),
        ...(embedding ? { embedding, embeddingModel: EMBEDDING_MODEL, embeddingTextHash: hashes.get(googlePlaceId)!, embeddedAt } : {}),
      }
      if (current) {
        const locked = new Set(current.manualOverrides.map((column) => KEY_BY_COLUMN.get(column)).filter(Boolean))
        const values = Object.fromEntries(Object.entries(row).filter(([key]) => !locked.has(key) && !NEVER_UPDATED.has(key)))
        await store.update(current.id, values)
        written.set(googlePlaceId, { googlePlaceId, id: current.id, action: 'updated', embedded: Boolean(embedding), ...failedEmbedding })
      } else {
        const id = await store.insert({ ...row, slug: slugs.get(googlePlaceId)!, status: 'published' })
        written.set(googlePlaceId, { googlePlaceId, id, action: 'created', embedded: Boolean(embedding), ...failedEmbedding })
      }
    } catch (error) {
      written.set(googlePlaceId, { googlePlaceId, id: current?.id ?? null, action: 'skipped', embedded: false, error: `No se pudo guardar: ${message(error)}` })
    }
  }, { concurrency: WRITE_CONCURRENCY })

  return unique.map((entry) => 'place' in entry ? written.get(entry.googlePlaceId)! : entry)
}

type Database = NeonHttpDatabase<typeof schema>

export function drizzlePlacesStore(db: Database): PlacesStore {
  return {
    async findByGooglePlaceIds(ids) {
      if (ids.length === 0) return []
      const rows = await db
        .select({ id: places.id, googlePlaceId: places.googlePlaceId, embeddingTextHash: places.embeddingTextHash, manualOverrides: places.manualOverrides })
        .from(places)
        .where(inArray(places.googlePlaceId, ids))
      return rows.flatMap((row) => row.googlePlaceId ? [{ ...row, googlePlaceId: row.googlePlaceId }] : [])
    },
    async slugsStartingWith(base) {
      // slugify sólo deja [a-z0-9-]: el patrón no trae comodines de LIKE.
      const rows = await db.select({ slug: places.slug }).from(places).where(or(eq(places.slug, base), like(places.slug, `${base}-%`)))
      return rows.map((row) => row.slug)
    },
    async insert(row) {
      const [inserted] = await db.insert(places).values(row).returning({ id: places.id })
      return inserted.id
    },
    async update(id, values) {
      await db.update(places).set(values).where(eq(places.id, id))
    },
  }
}

export function placesSaver(store: PlacesStore, embed: Embedder = gatewayEmbedder): PlacesSaver {
  return {
    save: (results) => savePlaces(results, { store, embed }),
    existing: async (ids) => (await store.findByGooglePlaceIds(ids)).map((row) => row.googlePlaceId),
  }
}
