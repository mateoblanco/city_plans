import { createHash } from 'node:crypto'
import { embedMany } from 'ai'
import { inArray, like, or, eq, sql } from 'drizzle-orm'
import pMap from 'p-map'
import { PlaceDraft } from '../../src/data/place-schema.ts'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from '../db/schema.ts'
import { places, type NewPlace, type Place } from '../db/schema.ts'
import { MISSING_NAME, toRow, type PlaceRow } from './to-row.ts'
import { slugify } from './slug.ts'
import { assignBrandKeys, brandSlug, instagramKey, sharedBrandKeys, type BrandRow } from './brand-key.ts'
import { computeProminence } from './prominence.ts'
import { parseManualOverrides, type ManualOverrides } from '../../src/data/manual-overrides.ts'
import { applyOverrides, overridesAffectSearch, placeSearchTexts } from './manual-overrides.ts'

export { slugify }

export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
const WRITE_CONCURRENCY = 5

export type SavePlaceResult = {
  googlePlaceId: string
  id: string | null
  action: 'created' | 'updated' | 'skipped'
  embedded: boolean
  error?: string
}

export type ExistingPlace = {
  id: string
  googlePlaceId: string
  embeddingTextHash: string | null
  manualOverrides: ManualOverrides
  status: Place['status']
}

/** Lo único que savePlaces necesita de la base; los tests usan un fake en memoria. */
export type PlacesStore = {
  findByGooglePlaceIds(ids: string[]): Promise<ExistingPlace[]>
  /** Slugs iguales a base o de la forma base-N. */
  slugsStartingWith(base: string): Promise<string[]>
  insert(row: NewPlace): Promise<string>
  update(id: string, values: Partial<NewPlace>): Promise<void>
  /** Lugares guardados con alguno de esos Instagram (handle en minúscula, sin @) o con alguna de esas brand_key. */
  brandRows(handles: string[], brandKeys: string[]): Promise<BrandRow[]>
  /** Sólo brand_key, sin tocar updatedAt: un lugar ya guardado que ahora comparte marca con uno del lote. */
  setBrandKey(id: string, brandKey: string | null): Promise<void>
  /** Sólo chain_branch = true y prominence, sin tocar updatedAt: un guardado que pasa a compartir brand_key. */
  setChainBranch(id: string, prominence: number): Promise<void>
}

export type Embedder = (texts: string[]) => Promise<number[][]>

export type PlacesSaver = {
  save(results: unknown[]): Promise<SavePlaceResult[]>
  existing(ids: string[]): Promise<string[]>
}

// Por el AI Gateway, con la misma AI_GATEWAY_API_KEY que el pipeline.
export const gatewayEmbedder: Embedder = async (values) => (await embedMany({ model: EMBEDDING_MODEL, values })).embeddings

// Una extracción nunca pisa la identidad ni la curaduría del lugar.
const NEVER_UPDATED = new Set(['id', 'googlePlaceId', 'slug', 'status', 'featured', 'createdAt'])

/**
 * Status que deja una extracción: review si tiene motivos, published si no. Al actualizar sólo mueve
 * published ↔ review: nunca toca draft ni hidden, ni un status puesto a mano (manualOverrides "status").
 * undefined = no cambiar.
 */
export function pipelineStatus(current: Pick<ExistingPlace, 'status' | 'manualOverrides'> | undefined, reviewReasons: readonly string[]): Place['status'] | undefined {
  const status = reviewReasons.length > 0 ? 'review' : 'published'
  if (!current) return status
  if (Object.hasOwn(current.manualOverrides, 'status')) return undefined
  return current.status === 'published' || current.status === 'review' ? status : undefined
}

/**
 * brand_key de los lugares del lote (por googlePlaceId), con los guardados que comparten Instagram o marca, y los
 * guardados que cambian por el lote (un Instagram que tenía un solo lugar y ahora tiene dos). Sólo se actualizan los
 * guardados leídos por Instagram: de esos se conoce el grupo entero. `chains`: los del lote cuya brand_key queda en 2+
 * lugares (sucursales de cadena); `newChains`: los guardados que pasan a serlo. null si no se pudo leer la base.
 */
async function brandKeysFor(candidates: Prepared[], store: PlacesStore) {
  const batch = candidates.map(({ googlePlaceId, row, current, overrides }) => ({
    googlePlaceId,
    row: {
      id: current?.id ?? googlePlaceId, name: row.name, neighborhoodId: row.neighborhoodId, instagram: row.instagram ?? null, chainBranch: row.chainBranch ?? false,
      locked: Object.hasOwn(overrides, 'brand_key'),
      lockedKey: overrides.brand_key ?? null,
    },
  }))
  const handles = [...new Set(batch.flatMap(({ row }) => instagramKey(row.instagram) ?? []))]
  let saved: BrandRow[]
  try {
    saved = await store.brandRows(handles, [...new Set(batch.map(({ row }) => brandSlug(row.name)))])
  } catch {
    return null
  }
  const savedById = new Map(saved.map((row) => [row.id, row]))
  const inBatch = new Set(batch.map(({ row }) => row.id))
  const { keys } = assignBrandKeys([
    ...batch.map(({ row: { lockedKey, ...row } }) => ({ ...row, brandKey: row.locked ? lockedKey : savedById.get(row.id)?.brandKey ?? null })),
    ...saved.filter((row) => !inBatch.has(row.id)),
  ])
  const handleSet = new Set(handles)
  // Todos los guardados con alguna de las keys finales, para contar sucursales aunque no salieran por Instagram ni slug.
  const finalKeys = [...new Set([...keys.values()].flatMap((key) => key ?? []))]
  let sameKey: BrandRow[]
  try {
    sameKey = finalKeys.length ? await store.brandRows([], finalKeys) : []
  } catch {
    return null
  }
  const others = saved.filter((row) => !inBatch.has(row.id) && !row.locked && handleSet.has(instagramKey(row.instagram) ?? '') && (row.brandKey ?? null) !== keys.get(row.id))
    .map((row) => ({ id: row.id, brandKey: keys.get(row.id) ?? null }))
  // Cada guardado con la key que va a quedar: la nueva si se actualiza, si no la que tiene.
  const updatedKeys = new Map(others.map((row) => [row.id, row.brandKey]))
  const known = new Map<string, BrandRow>([...saved, ...sameKey].filter((row) => !inBatch.has(row.id)).map((row) => [row.id, row]))
  const shared = sharedBrandKeys([
    ...[...known.values()].map((row) => ({ id: row.id, brandKey: updatedKeys.has(row.id) ? updatedKeys.get(row.id) ?? null : row.brandKey ?? null })),
    ...batch.map(({ row }) => ({ id: row.id, brandKey: keys.get(row.id) ?? null })),
  ])
  return {
    batch: new Map(batch.map(({ googlePlaceId, row }) => [googlePlaceId, keys.get(row.id) ?? null])),
    chains: new Set(batch.flatMap(({ googlePlaceId, row }) => shared.has(row.id) ? [googlePlaceId] : [])),
    newChains: [...known.values()].filter((row) => shared.has(row.id) && !row.chainBranch)
      .map((row) => ({ id: row.id, prominence: computeProminence({ igFollowers: row.igFollowers ?? null, chainBranch: true }) })),
    others,
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const message = (error: unknown) => error instanceof Error ? error.message : String(error)

/** manualInstagram: el Instagram cargado a mano en la revisión (review.instagramManual); handle null = "No tiene". */
type Candidate = { googlePlaceId: string; place: ValidDraft & { neighborhoodId: string }; manualInstagram: { handle: string | null } | null }

/** Un lugar del lote con su fila final (lo automático con los overrides encima) y los overrides que quedan. */
type Prepared = Candidate & { current: ExistingPlace | undefined; row: PlaceRow; overrides: ManualOverrides; overridesChanged: boolean }

type ValidDraft = import('zod').infer<typeof PlaceDraft>

/** Lee un resultado del pipeline: un place válido para guardar, un skip con motivo, o null si se ignora. */
function candidateFrom(result: unknown): Candidate | SavePlaceResult | null {
  const value = (typeof result === 'object' && result !== null ? result : {}) as { status?: unknown; place?: unknown; target?: { googlePlaceId?: unknown }; review?: { instagramManual?: { handle?: unknown } | null } }
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
  // El handle sale de la revisión y no del contacto: el post-proceso puede sacar del contacto un Instagram compartido.
  const manual = value.review?.instagramManual
  const manualInstagram = typeof manual === 'object' && manual !== null
    ? { handle: typeof manual.handle === 'string' ? instagramKey(manual.handle) : null }
    : null
  return { googlePlaceId: parsed.data.googlePlaceId, place: { ...parsed.data, neighborhoodId }, manualInstagram }
}

/**
 * Fila final de un lugar del lote: toRow con los overrides manuales encima (applyOverrides). Un Instagram cargado a
 * mano en la revisión pasa a ser el override de instagram (pisa al anterior). Si un override cambia lo que entra en
 * la búsqueda, los textos se arman de nuevo con los valores finales: los del borrador son de los automáticos.
 */
function prepare(candidate: Candidate, current: ExistingPlace | undefined): Prepared {
  const { place, manualInstagram } = candidate
  const base = current?.manualOverrides ?? {}
  const overrides: ManualOverrides = manualInstagram ? { ...base, instagram: manualInstagram.handle } : base
  let row = applyOverrides(toRow(place), overrides)
  if (overridesAffectSearch(overrides)) {
    row = { ...row, ...placeSearchTexts({
      name: row.name, neighborhoodId: row.neighborhoodId, descriptionEs: row.descriptionEs ?? null, descriptionEn: row.descriptionEn ?? null,
      locatedIn: row.locatedIn ?? null, categories: row.categories ?? [], tags: row.tags ?? [], dietVegan: row.dietVegan ?? 'unknown',
      dietVegetarian: row.dietVegetarian ?? 'unknown', dietGlutenFree: row.dietGlutenFree ?? 'unknown', highlights: row.highlights ?? [],
      dishes: row.dishes ?? [], signature: row.signature ?? [], style: row.style ?? null,
    }) }
  }
  const overridesChanged = manualInstagram !== null && (!current || base.instagram !== manualInstagram.handle || !Object.hasOwn(base, 'instagram'))
  return { ...candidate, current, row, overrides, overridesChanged }
}

/**
 * Guarda los resultados del pipeline en `places`. Los status "error" se ignoran; cada lugar se
 * escribe por separado, así que una falla no corta el resto. Un embedding fallido no impide guardar.
 * Los campos editados a mano (manual_overrides) quedan como estaban; en tags se aplica la diferencia, así los
 * tags nuevos entran y los sacados a mano no vuelven. Un Instagram cargado a mano en la revisión pasa a override.
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

  const written = new Map<string, SavePlaceResult>()
  const failed = (googlePlaceId: string, error: unknown) =>
    written.set(googlePlaceId, { googlePlaceId, id: existing.get(googlePlaceId)?.id ?? null, action: 'skipped', embedded: false, error: `No se pudo guardar: ${message(error)}` })
  // Si toRow rechaza un lugar, falla sólo ese y no el lote.
  const prepared = candidates.flatMap((candidate) => {
    try {
      return [prepare(candidate, existing.get(candidate.googlePlaceId))]
    } catch (error) {
      failed(candidate.googlePlaceId, error)
      return []
    }
  })

  // Slugs de los nuevos: se reservan en orden, contando los de la base y los del mismo lote.
  const slugs = new Map<string, string>()
  const usedInBatch = new Set<string>()
  for (const { googlePlaceId, row, current } of prepared) {
    if (current) continue
    const base = slugify(row.name)
    const taken = new Set([...await store.slugsStartingWith(base), ...usedInBatch])
    let slug = base
    for (let suffix = 2; taken.has(slug); suffix += 1) slug = `${base}-${suffix}`
    usedInBatch.add(slug)
    slugs.set(googlePlaceId, slug)
  }

  const brands = prepared.length > 0 ? await brandKeysFor(prepared, store) : null

  // Embeddings: sólo los que cambiaron de texto, todos en un único llamado.
  const hashes = new Map(prepared.map(({ googlePlaceId, row }) => [googlePlaceId, sha256(row.embeddingText ?? '')]))
  const toEmbed = prepared.filter(({ googlePlaceId, current, row }) => row.embeddingText && current?.embeddingTextHash !== hashes.get(googlePlaceId))
  const embeddings = new Map<string, number[]>()
  let embedError: string | null = null
  if (toEmbed.length > 0) {
    try {
      const vectors = await embed(toEmbed.map(({ row }) => row.embeddingText!))
      toEmbed.forEach(({ googlePlaceId }, index) => { if (vectors[index]) embeddings.set(googlePlaceId, vectors[index]) })
    } catch (error) {
      embedError = `No se pudieron generar los embeddings: ${message(error)}`
    }
  }
  const embeddedAt = new Date()

  await pMap(prepared, async ({ googlePlaceId, row: finalRow, current, overrides, overridesChanged }) => {
    const embedding = embeddings.get(googlePlaceId)
    const failedEmbedding = embedError && toEmbed.some((entry) => entry.googlePlaceId === googlePlaceId) ? { error: embedError } : {}
    try {
      // Un brand_key bloqueado ya quedó en la fila final: no lo pisa el agrupado.
      const brandKey = brands && !Object.hasOwn(overrides, 'brand_key') ? { brandKey: brands.batch.get(googlePlaceId) ?? null } : {}
      // Comparte brand_key con otro lugar: sucursal de cadena, con los seguidores de la marca descontados.
      const chain = !finalRow.chainBranch && brands?.chains.has(googlePlaceId)
        ? { chainBranch: true, prominence: computeProminence({ igFollowers: finalRow.igFollowers ?? null, chainBranch: true }) }
        : {}
      const row: Omit<NewPlace, 'slug'> = {
        ...finalRow,
        ...brandKey,
        ...chain,
        ...(embedding ? { embedding, embeddingModel: EMBEDDING_MODEL, embeddingTextHash: hashes.get(googlePlaceId)!, embeddedAt } : {}),
      }
      if (current) {
        const values: Partial<NewPlace> = {
          ...Object.fromEntries(Object.entries(row).filter(([key]) => !NEVER_UPDATED.has(key))),
          ...(overridesChanged ? { manualOverrides: overrides } : {}),
        }
        const status = pipelineStatus(current, row.reviewReasons ?? [])
        await store.update(current.id, status && status !== current.status ? { ...values, status } : values)
        written.set(googlePlaceId, { googlePlaceId, id: current.id, action: 'updated', embedded: Boolean(embedding), ...failedEmbedding })
      } else {
        const id = await store.insert({ ...row, slug: slugs.get(googlePlaceId)!, status: pipelineStatus(undefined, row.reviewReasons ?? []), ...(overridesChanged ? { manualOverrides: overrides } : {}) })
        written.set(googlePlaceId, { googlePlaceId, id, action: 'created', embedded: Boolean(embedding), ...failedEmbedding })
      }
    } catch (error) {
      failed(googlePlaceId, error)
    }
  }, { concurrency: WRITE_CONCURRENCY })
  // Si falla, el lugar guardado queda con su marca anterior hasta el próximo brands:backfill; no corta el lote.
  await pMap(brands?.others ?? [], ({ id, brandKey }) => store.setBrandKey(id, brandKey).catch(() => {}), { concurrency: WRITE_CONCURRENCY })
  await pMap(brands?.newChains ?? [], ({ id, prominence }) => store.setChainBranch(id, prominence).catch(() => {}), { concurrency: WRITE_CONCURRENCY })

  return unique.map((entry) => 'place' in entry ? written.get(entry.googlePlaceId)! : entry)
}

type Database = NeonHttpDatabase<typeof schema>

export function drizzlePlacesStore(db: Database): PlacesStore {
  return {
    async findByGooglePlaceIds(ids) {
      if (ids.length === 0) return []
      const rows = await db
        .select({
          id: places.id, googlePlaceId: places.googlePlaceId, embeddingTextHash: places.embeddingTextHash, manualOverrides: places.manualOverrides, status: places.status,
        })
        .from(places)
        .where(inArray(places.googlePlaceId, ids))
      return rows.flatMap((row) => row.googlePlaceId ? [{ ...row, googlePlaceId: row.googlePlaceId, manualOverrides: parseManualOverrides(row.manualOverrides) }] : [])
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
    async brandRows(handles, brandKeys) {
      const conditions = [
        ...(handles.length ? [inArray(sql`lower(trim(leading '@' from ${places.instagram}))`, handles)] : []),
        ...(brandKeys.length ? [inArray(places.brandKey, brandKeys)] : []),
      ]
      if (conditions.length === 0) return []
      return db
        .select({
          id: places.id, name: places.name, neighborhoodId: places.neighborhoodId, instagram: places.instagram, chainBranch: places.chainBranch, brandKey: places.brandKey,
          igFollowers: places.igFollowers, locked: sql<boolean>`${places.manualOverrides} ? 'brand_key'`,
        })
        .from(places)
        .where(or(...conditions))
    },
    async setBrandKey(id, brandKey) {
      await db.update(places).set({ brandKey, updatedAt: places.updatedAt }).where(eq(places.id, id))
    },
    async setChainBranch(id, prominence) {
      await db.update(places).set({ chainBranch: true, prominence, updatedAt: places.updatedAt }).where(eq(places.id, id))
    },
  }
}

export function placesSaver(store: PlacesStore, embed: Embedder = gatewayEmbedder): PlacesSaver {
  return {
    save: (results) => savePlaces(results, { store, embed }),
    existing: async (ids) => (await store.findByGooglePlaceIds(ids)).map((row) => row.googlePlaceId),
  }
}
