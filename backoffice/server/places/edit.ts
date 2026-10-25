import { createHash } from 'node:crypto'
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from '../db/schema.ts'
import { places, type NewPlace, type Place } from '../db/schema.ts'
import { parseManualOverrides, editedFields, type ManualOverrides, type PlaceEdit } from '../../src/data/manual-overrides.ts'
import type {
  InstagramOwner, LogoIssue, ManualLogoUpload, PlaceDeleteResult, PlaceDetail, PlaceEditPlan, PlaceEditResult,
} from '../../src/types/places.ts'
import type { InstagramProfileData } from '../providers/apify-instagram-provider.ts'
import { logoUrl } from '../providers/logo-storage.ts'
import { fetchPlaceLogo, processLogoImage, type LogoDeps } from '../providers/place-logo.ts'
import { llmUsageCost, LLM_PRICES_PER_MILLION } from '../providers/place-extraction-service.ts'
import { assignBrandKeys, brandSlug, instagramKey, type BrandRow } from './brand-key.ts'
import { changedEditFields, mergeEdit, placeSearchTexts } from './manual-overrides.ts'
import { computeProminence } from './prominence.ts'
import { instagramProfileUrl } from './refresh-signals.ts'
import { EMBEDDING_MODEL, type Embedder } from './save.ts'
import { estimatedEmbeddingUsd } from './search-text-backfill.ts'

/** Lo que la edición lee de un lugar guardado. */
export type EditRow = Pick<Place,
  'id' | 'googlePlaceId' | 'name' | 'address' | 'neighborhoodId' | 'status' | 'descriptionEs' | 'descriptionEn' | 'locatedIn' |
  'categories' | 'tags' | 'signature' | 'dishes' | 'highlights' | 'dietVegan' | 'dietVegetarian' | 'dietGlutenFree' |
  'price' | 'style' | 'iconCategory' | 'instagram' | 'website' | 'brandKey' | 'featured' | 'logoKey' | 'logoKind' |
  'logoBgColor' | 'logoColor' | 'logoSource' | 'igFollowers' | 'chainBranch' | 'prominence' | 'embeddingTextHash'> & {
  manualOverrides: ManualOverrides
}

/** Lo único que la edición necesita de la base; los tests usan un fake en memoria. */
export type EditStore = {
  get(id: string): Promise<EditRow | null>
  /** brand_key distintas de todos los lugares, para sugerir en el modal. */
  brandKeys(): Promise<string[]>
  /** Otros lugares con ese Instagram (handle en minúscula, sin @). */
  instagramOwners(handle: string, exceptId: string): Promise<InstagramOwner[]>
  /** Lugares guardados con alguno de esos Instagram o brand_key (como en savePlaces). */
  brandRows(handles: string[], brandKeys: string[]): Promise<BrandRow[]>
  /** touch: false deja updatedAt como estaba (sólo curaduría, como el destacado). */
  update(id: string, values: Partial<NewPlace>, options: { touch: boolean }): Promise<void>
  setBrandKey(id: string, brandKey: string | null): Promise<void>
  /** Sólo chain_branch = true y prominence, sin tocar updatedAt: otro lugar que pasa a compartir brand_key. */
  setChainBranch(id: string, prominence: number): Promise<void>
  delete(id: string): Promise<boolean>
}

export type EditDeps = {
  store: EditStore
  embed: Embedder
  /** Perfil por Apify; sin él (Apify sin configurar) no se puede cambiar el Instagram. */
  scrapeInstagram?: (profileUrl: string) => Promise<InstagramProfileData | null>
  logo: LogoDeps
  /** Costo de una corrida de Apify (EXTRACTION_COST_INSTAGRAM_RUN_USD). */
  instagramRunUsd: number
  /** Mueve el snapshot del lugar a cache/extractions/deleted/. */
  archiveSnapshot(googlePlaceId: string): Promise<string | null>
  /** Olvida lo que el server tiene en memoria del lugar (descubrimiento, candidatos de Instagram). */
  forget?(googlePlaceId: string): void
  now?: () => Date
}

export type EditErrorCode = 'NOT_FOUND_ERROR' | 'INSTAGRAM_IN_USE' | 'INSTAGRAM_NOT_FOUND' | 'INSTAGRAM_PROVIDER_ERROR' | 'CONFIGURATION_ERROR' | 'LOGO_INVALID'

/** Error con el código y el status HTTP que devuelve la API. */
export class EditError extends Error {
  readonly code: EditErrorCode
  readonly status: 404 | 409 | 422 | 502 | 503
  readonly owners?: InstagramOwner[]

  constructor(code: EditErrorCode, status: EditError['status'], message: string, owners?: InstagramOwner[]) {
    super(message)
    this.code = code
    this.status = status
    this.owners = owners
  }
}

const NOT_FOUND = 'El lugar no existe.'
const message = (error: unknown) => error instanceof Error ? error.message : String(error)
const round = (value: number) => Math.round(value * 1e6) / 1e6

// Lo que entra en los textos de búsqueda. El precio no: la app lo filtra por la columna.
const SEARCH_FIELDS = new Set<keyof PlaceEdit>(['name', 'tags', 'style', 'dietVegan', 'dietVegetarian', 'dietGlutenFree'])

/** Clasificación del logo con el modelo del logo: ~1.500 tokens de entrada (la imagen a 512 px) y unos pocos de salida. */
export function estimatedLogoClassificationUsd(model: string) {
  const price = LLM_PRICES_PER_MILLION[model]
  return price ? round((1500 * price.input + 20 * price.output) / 1_000_000) : 0
}

export function toDetail(row: EditRow, brandKeys: string[] = []): PlaceDetail {
  return {
    id: row.id,
    googlePlaceId: row.googlePlaceId,
    name: row.name,
    address: row.address,
    neighborhoodId: row.neighborhoodId,
    status: row.status,
    categories: row.categories,
    tags: row.tags as PlaceDetail['tags'],
    style: row.style,
    iconCategory: row.iconCategory,
    price: row.price,
    dietVegan: row.dietVegan,
    dietVegetarian: row.dietVegetarian,
    dietGlutenFree: row.dietGlutenFree,
    instagram: instagramKey(row.instagram),
    website: row.website,
    brandKey: row.brandKey,
    featured: row.featured,
    logoUrl: logoUrl(row.logoKey),
    logoKind: row.logoKind,
    logoBgColor: row.logoBgColor,
    logoColor: row.logoColor,
    logoSource: row.logoSource,
    igFollowers: row.igFollowers,
    prominence: row.prominence,
    manualOverrides: row.manualOverrides,
    editedFields: editedFields(row.manualOverrides),
    brandKeys,
  }
}

/** Valores finales de los campos editados: lo que se escribe en las columnas (sin los recálculos). */
function editedValues(row: EditRow, edit: PlaceEdit, changed: readonly (keyof PlaceEdit)[]): Partial<NewPlace> {
  const values: Partial<NewPlace> = {}
  for (const key of changed) {
    if (key === 'tags') {
      values.tags = edit.tags!
      // signature es un subconjunto de tags: un tag sacado a mano sale también de ahí.
      values.signature = row.signature.filter((id) => edit.tags!.includes(id as never))
    } else if (key === 'logo') {
      const logo = edit.logo!
      Object.assign(values, { logoKey: logo.key, logoKind: logo.kind, logoBgColor: logo.bgColor, logoColor: logo.color, logoSource: logo.source, logoFetchedAt: new Date(logo.fetchedAt) })
    } else {
      (values as Record<string, unknown>)[key] = edit[key]
    }
  }
  return values
}

/**
 * Qué se recalcula al guardar la edición y cuánto cuesta. Si cambia algo de la búsqueda (nombre, tags, cocinas,
 * style, dietas): textos y embedding. Si cambia el Instagram: el perfil con Apify, el logo (salvo uno subido a mano),
 * los seguidores con la prominencia y el agrupado de marca. El precio, el ícono, la web y el destacado sólo escriben
 * la columna.
 */
export async function planEdit(row: EditRow, edit: PlaceEdit, deps: Pick<EditDeps, 'store' | 'instagramRunUsd' | 'logo'>): Promise<PlaceEditPlan> {
  const changed = changedEditFields(row, edit)
  const steps: PlaceEditPlan['steps'] = []
  if (changed.some((key) => SEARCH_FIELDS.has(key))) {
    const values = { ...row, ...editedValues(row, edit, changed) } as EditRow
    const { embeddingText } = placeSearchTexts(values)
    steps.push({ id: 'search_texts', label: 'Texto de búsqueda y búsqueda por palabra (search_tsv)', costUsd: 0 })
    const hash = createHash('sha256').update(embeddingText).digest('hex')
    if (hash !== row.embeddingTextHash) steps.push({ id: 'embedding', label: 'Embedding (text-embedding-3-small)', costUsd: round(estimatedEmbeddingUsd(embeddingText)) })
  }
  let instagramOwners: InstagramOwner[] = []
  if (changed.includes('instagram')) {
    if (edit.instagram) {
      steps.push({ id: 'instagram_profile', label: `Perfil de @${edit.instagram} con Apify (logo, colores y seguidores)`, costUsd: round(deps.instagramRunUsd) })
      if (!row.manualOverrides.logo && !edit.logo) {
        steps.push({ id: 'logo_classification', label: 'Logo desde la foto de perfil (clasificación con Haiku)', costUsd: estimatedLogoClassificationUsd(deps.logo.model) })
      }
      instagramOwners = await deps.store.instagramOwners(edit.instagram, row.id)
    }
    steps.push({ id: 'prominence', label: edit.instagram ? 'Seguidores y prominencia' : 'Sin Instagram: prominencia neutra (0,5)', costUsd: 0 })
    if (!changed.includes('brandKey') && !Object.hasOwn(row.manualOverrides, 'brand_key')) {
      steps.push({ id: 'brand_keys', label: 'Agrupado de sucursales (brand_key) por el Instagram y sucursal de cadena', costUsd: 0 })
    }
  }
  if (changed.includes('brandKey')) steps.push({ id: 'brand_keys', label: 'Agrupado de sucursales (brand_key) y sucursal de cadena', costUsd: 0 })
  if (steps.length === 0 && changed.length > 0) steps.push({ id: 'column_only', label: 'Sólo se guardan los campos, sin recálculos', costUsd: 0 })
  return { changed, steps, totalUsd: round(steps.reduce((sum, step) => sum + step.costUsd, 0)), instagramOwners }
}

/** brand_key de este lugar y de los que comparten su Instagram (viejo o nuevo), como en savePlaces. */
async function brandKeyChanges(row: EditRow, next: { name: string; instagram: string | null; brandKey: string | null; locked: boolean }, store: EditStore) {
  const handles = [...new Set([instagramKey(row.instagram), instagramKey(next.instagram)].flatMap((handle) => handle ?? []))]
  const saved = (await store.brandRows(handles, [...new Set([row.brandKey, brandSlug(next.name)].flatMap((key) => key ?? []))]))
    .filter((other) => other.id !== row.id)
  const self: BrandRow = { id: row.id, name: next.name, neighborhoodId: row.neighborhoodId, instagram: next.instagram, chainBranch: row.chainBranch, brandKey: next.brandKey, locked: next.locked }
  const { keys } = assignBrandKeys([self, ...saved])
  const handleSet = new Set(handles)
  return {
    self: keys.get(row.id) ?? null,
    // Sólo los leídos por Instagram: de esos se conoce el grupo entero.
    others: saved.filter((other) => !other.locked && handleSet.has(instagramKey(other.instagram) ?? '') && (other.brandKey ?? null) !== (keys.get(other.id) ?? null))
      .map((other) => ({ id: other.id, brandKey: keys.get(other.id) ?? null })),
  }
}

/**
 * Guarda una edición: los campos, manual_overrides (los campos de un valor quedan bloqueados con su valor; los tags
 * con la diferencia) y los recálculos del plan. No re-extrae el lugar. Si el Instagram nuevo ya lo tiene otro lugar,
 * hace falta confirmSharedInstagram (puede ser otra sucursal). Si el perfil no existe o Apify falla, no guarda nada.
 * Si falla el embedding, guarda igual y vuelve el aviso.
 */
export async function applyEdit(id: string, edit: PlaceEdit, deps: EditDeps, options: { confirmSharedInstagram?: boolean } = {}): Promise<PlaceEditResult> {
  const { store } = deps
  const row = await store.get(id)
  if (!row) throw new EditError('NOT_FOUND_ERROR', 404, NOT_FOUND)
  const plan = await planEdit(row, edit, deps)
  if (plan.instagramOwners.length > 0 && !options.confirmSharedInstagram) {
    const names = plan.instagramOwners.map((owner) => owner.name).join(', ')
    throw new EditError('INSTAGRAM_IN_USE', 409, `@${edit.instagram} ya está en ${names}. Confirmá si es otra sucursal.`, plan.instagramOwners)
  }
  if (plan.changed.length === 0) return { place: toDetail(row, await store.brandKeys()), warnings: [] }

  const warnings: string[] = []
  const overrides = mergeEdit(row.manualOverrides, row, edit)
  const values: Partial<NewPlace> = { ...editedValues(row, edit, plan.changed), manualOverrides: overrides }

  if (plan.changed.includes('instagram')) {
    let followers: number | null = null
    if (edit.instagram) {
      if (!deps.scrapeInstagram) throw new EditError('CONFIGURATION_ERROR', 503, 'Falta configurar APIFY_API_TOKEN: no se puede leer el perfil de Instagram.')
      let profile: InstagramProfileData | null
      try {
        profile = await deps.scrapeInstagram(instagramProfileUrl(edit.instagram))
      } catch (error) {
        throw new EditError('INSTAGRAM_PROVIDER_ERROR', 502, `Apify no pudo leer @${edit.instagram}: ${message(error)}. No se guardó nada.`)
      }
      if (!profile) throw new EditError('INSTAGRAM_NOT_FOUND', 422, `No existe el perfil @${edit.instagram} (o es privado). No se guardó nada.`)
      followers = typeof profile.followers === 'number' ? profile.followers : null
      if (followers === null) warnings.push('El perfil no trajo seguidores: queda con prominencia neutra.')
      // Un logo subido a mano no se pisa.
      if (!overrides.logo) {
        const outcome = await fetchPlaceLogo(profile, row.googlePlaceId ?? row.id, deps.logo)
        if (outcome.logo) {
          const { key, kind, bgColor, color, source, fetchedAt } = outcome.logo
          Object.assign(values, { logoKey: key, logoKind: kind, logoBgColor: bgColor, logoColor: color, logoSource: source, logoFetchedAt: new Date(fetchedAt) })
        } else {
          warnings.push(`Logo: ${LOGO_ISSUES[outcome.review.reason ?? 'processing_failed'] ?? outcome.review.reason}; queda el anterior.`)
        }
      }
    }
    values.igFollowers = followers
    values.prominence = computeProminence({ igFollowers: followers, chainBranch: row.chainBranch })
  }

  let othersBrandKeys: { id: string; brandKey: string | null }[] = []
  if (plan.changed.includes('instagram') && !Object.hasOwn(overrides, 'brand_key')) {
    try {
      // Sin su key anterior: con otro Instagram puede pasar a otro grupo (o a ninguno).
      const brands = await brandKeyChanges(row, { name: (values.name as string | undefined) ?? row.name, instagram: edit.instagram ?? null, brandKey: null, locked: false }, store)
      values.brandKey = brands.self
      othersBrandKeys = brands.others
    } catch (error) {
      warnings.push(`No se pudo recalcular el agrupado de sucursales: ${message(error)}. Corré yarn brands:backfill.`)
    }
  }

  // Con la brand_key final compartida, este lugar y los otros de la marca son sucursales de cadena. Si queda sola no se
  // desmarca: no se sabe si la cadena venía del nombre de Google.
  let newChains: { id: string; prominence: number }[] = []
  if (plan.changed.includes('instagram') || plan.changed.includes('brandKey')) {
    const finalKey = Object.hasOwn(values, 'brandKey') ? values.brandKey ?? null : row.brandKey
    try {
      const updatedKeys = new Map(othersBrandKeys.map((other) => [other.id, other.brandKey]))
      const read = finalKey ? await store.brandRows([], [finalKey]) : []
      const siblings = new Map(read.filter((other) => other.id !== id).map((other) => [other.id, other]))
      const rows = [...siblings.values()].filter((other) => (updatedKeys.has(other.id) ? updatedKeys.get(other.id) : other.brandKey) === finalKey)
      if (rows.length > 0) {
        if (!row.chainBranch) {
          values.chainBranch = true
          values.prominence = computeProminence({ igFollowers: Object.hasOwn(values, 'igFollowers') ? values.igFollowers ?? null : row.igFollowers, chainBranch: true })
        }
        newChains = rows.filter((other) => !other.chainBranch).map((other) => ({ id: other.id, prominence: computeProminence({ igFollowers: other.igFollowers ?? null, chainBranch: true }) }))
      }
    } catch (error) {
      warnings.push(`No se pudo recalcular la sucursal de cadena: ${message(error)}. Corré yarn chains:backfill.`)
    }
  }

  if (plan.changed.some((key) => SEARCH_FIELDS.has(key))) {
    const texts = placeSearchTexts({ ...row, ...values } as EditRow)
    Object.assign(values, texts)
    const hash = createHash('sha256').update(texts.embeddingText).digest('hex')
    if (hash !== row.embeddingTextHash) {
      try {
        const [embedding] = await deps.embed([texts.embeddingText])
        Object.assign(values, { embedding, embeddingModel: EMBEDDING_MODEL, embeddingTextHash: hash, embeddedAt: deps.now?.() ?? new Date() })
      } catch (error) {
        warnings.push(`Se guardó, pero no se pudo generar el embedding: ${message(error)}. La búsqueda semántica usa el anterior hasta reprocesar.`)
      }
    }
  }

  // Sólo el destacado es curaduría: no cambia updatedAt, como el checkbox de la tabla.
  await store.update(id, values, { touch: plan.changed.some((key) => key !== 'featured') })
  for (const other of othersBrandKeys) {
    await store.setBrandKey(other.id, other.brandKey).catch((error: unknown) => warnings.push(`No se pudo actualizar la marca de otra sucursal: ${message(error)}`))
  }
  for (const other of newChains) {
    await store.setChainBranch(other.id, other.prominence).catch((error: unknown) => warnings.push(`No se pudo marcar otra sucursal como cadena: ${message(error)}`))
  }
  const updated = await store.get(id)
  return { place: toDetail(updated ?? { ...row, ...values, manualOverrides: overrides } as EditRow, await store.brandKeys()), warnings }
}

// Motivos del logo en español (los mismos que ISSUE_LABELS del frontend).
const LOGO_ISSUES: Partial<Record<LogoIssue, string>> = {
  no_picture: 'el perfil no tiene foto',
  download_failed: 'no se pudo descargar la foto',
  not_image: 'el archivo no es una imagen',
  too_small: 'la imagen mide menos de 150 px',
  generic_avatar: 'es el avatar genérico de Instagram',
  processing_failed: 'no se pudo procesar la imagen',
  storage_not_configured: 'falta configurar R2',
  upload_failed: 'no se pudo subir a R2',
  person_photo: 'la foto es de una persona',
}

/**
 * Logo subido a mano: se procesa igual que el de Instagram (WebP 256, colores, clasificación, R2 con hash en la clave)
 * y vuelve sin guardar en el lugar; se guarda con la edición. Si no se guarda, la clave queda para logos:cleanup.
 */
export async function uploadLogo(id: string, image: Buffer, contentType: string | null, deps: Pick<EditDeps, 'store' | 'logo'>): Promise<ManualLogoUpload> {
  const row = await deps.store.get(id)
  if (!row) throw new EditError('NOT_FOUND_ERROR', 404, NOT_FOUND)
  const outcome = await processLogoImage(image, row.googlePlaceId ?? row.id, deps.logo, { source: 'manual', contentType })
  if (!outcome.logo) {
    const reason = outcome.review.reason ?? 'processing_failed'
    const status = reason === 'storage_not_configured' ? 503 : reason === 'upload_failed' ? 502 : 422
    throw new EditError(status === 503 ? 'CONFIGURATION_ERROR' : 'LOGO_INVALID', status, `No se pudo usar el logo: ${LOGO_ISSUES[reason] ?? reason}.`)
  }
  const cost = outcome.classification ? llmUsageCost(outcome.classification.model, outcome.classification.usage) : null
  return {
    logo: { ...outcome.logo, source: 'manual' },
    logoUrl: logoUrl(outcome.logo.key),
    classificationUsd: cost ? round(cost.inputCost + cost.outputCost) : 0,
  }
}

/**
 * Borra un lugar. El logo queda en R2 para logos:cleanup; el snapshot va a cache/extractions/deleted/; el server olvida
 * su descubrimiento y sus candidatos de Instagram; y las sucursales que compartían Instagram o marca se reagrupan sin
 * él (sin tocar las marcas editadas a mano).
 */
export async function deletePlace(id: string, deps: EditDeps): Promise<PlaceDeleteResult & { warnings: string[] }> {
  const { store } = deps
  const row = await store.get(id)
  if (!row) throw new EditError('NOT_FOUND_ERROR', 404, NOT_FOUND)
  const warnings: string[] = []

  // El grupo antes de borrar: los que comparten Instagram o brand_key, más los grupos de Instagram de esos.
  let group: BrandRow[] = []
  try {
    const first = await store.brandRows([instagramKey(row.instagram)].flatMap((handle) => handle ?? []), row.brandKey ? [row.brandKey] : [])
    const handles = [...new Set(first.flatMap((other) => instagramKey(other.instagram) ?? []))]
    group = handles.length ? await store.brandRows(handles, row.brandKey ? [row.brandKey] : []) : first
  } catch (error) {
    warnings.push(`No se pudo leer el agrupado de sucursales: ${message(error)}. Corré yarn brands:backfill.`)
  }

  if (!await store.delete(id)) throw new EditError('NOT_FOUND_ERROR', 404, NOT_FOUND)

  const remaining = group.filter((other) => other.id !== id)
  const { keys } = assignBrandKeys(remaining)
  const brandKeys: PlaceDeleteResult['brandKeys'] = []
  for (const other of remaining) {
    const next = keys.get(other.id) ?? null
    if (other.locked || (other.brandKey ?? null) === next) continue
    try {
      await store.setBrandKey(other.id, next)
      brandKeys.push({ id: other.id, name: other.name, brandKey: next })
    } catch (error) {
      warnings.push(`No se pudo actualizar la marca de ${other.name}: ${message(error)}`)
    }
  }

  let snapshot: string | null = null
  if (row.googlePlaceId) {
    deps.forget?.(row.googlePlaceId)
    try {
      snapshot = await deps.archiveSnapshot(row.googlePlaceId)
    } catch (error) {
      warnings.push(`No se pudo mover el snapshot de cache/extractions: ${message(error)}`)
    }
  }
  return { id, snapshot, brandKeys, logoKey: row.logoKey, warnings }
}

type Database = NeonHttpDatabase<typeof schema>

const EDIT_COLUMNS = {
  id: places.id, googlePlaceId: places.googlePlaceId, name: places.name, address: places.address, neighborhoodId: places.neighborhoodId, status: places.status,
  descriptionEs: places.descriptionEs, descriptionEn: places.descriptionEn, locatedIn: places.locatedIn, categories: places.categories,
  tags: places.tags, signature: places.signature, dishes: places.dishes, highlights: places.highlights, dietVegan: places.dietVegan,
  dietVegetarian: places.dietVegetarian, dietGlutenFree: places.dietGlutenFree, price: places.price, style: places.style,
  iconCategory: places.iconCategory, instagram: places.instagram, website: places.website, brandKey: places.brandKey,
  featured: places.featured, logoKey: places.logoKey, logoKind: places.logoKind, logoBgColor: places.logoBgColor,
  logoColor: places.logoColor, logoSource: places.logoSource, igFollowers: places.igFollowers, chainBranch: places.chainBranch,
  prominence: places.prominence, embeddingTextHash: places.embeddingTextHash, manualOverrides: places.manualOverrides,
}

export function drizzleEditStore(db: Database): EditStore {
  const handle = sql<string>`lower(regexp_replace(${places.instagram}, '^@', ''))`
  return {
    async get(id) {
      const [row] = await db.select(EDIT_COLUMNS).from(places).where(eq(places.id, id)).limit(1)
      return row ? { ...row, manualOverrides: parseManualOverrides(row.manualOverrides) } : null
    },
    async brandKeys() {
      const rows = await db.selectDistinct({ brandKey: places.brandKey }).from(places).where(sql`${places.brandKey} is not null`).orderBy(places.brandKey)
      return rows.flatMap((row) => row.brandKey ?? [])
    },
    async instagramOwners(value, exceptId) {
      return db.select({ id: places.id, name: places.name, neighborhoodId: places.neighborhoodId, brandKey: places.brandKey })
        .from(places)
        .where(and(eq(handle, value.toLowerCase()), ne(places.id, exceptId)))
    },
    async brandRows(handles, brandKeys) {
      const conditions = [
        ...(handles.length ? [inArray(handle, handles)] : []),
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
    async update(id, values, { touch }) {
      await db.update(places).set(touch ? values : { ...values, updatedAt: places.updatedAt }).where(eq(places.id, id))
    },
    async setBrandKey(id, brandKey) {
      await db.update(places).set({ brandKey, updatedAt: places.updatedAt }).where(eq(places.id, id))
    },
    async setChainBranch(id, prominence) {
      await db.update(places).set({ chainBranch: true, prominence, updatedAt: places.updatedAt }).where(eq(places.id, id))
    },
    async delete(id) {
      const deleted = await db.delete(places).where(eq(places.id, id)).returning({ id: places.id })
      return deleted.length > 0
    },
  }
}

/** Lo que la API usa para editar: get, plan (dry run), guardar, subir el logo y borrar. */
export type PlaceEditor = {
  get(id: string): Promise<PlaceDetail | null>
  plan(id: string, edit: PlaceEdit): Promise<PlaceEditPlan>
  apply(id: string, edit: PlaceEdit, options: { confirmSharedInstagram?: boolean }): Promise<PlaceEditResult>
  uploadLogo(id: string, image: Buffer, contentType: string | null): Promise<ManualLogoUpload>
  delete(id: string): Promise<PlaceDeleteResult & { warnings: string[] }>
}

export function placeEditor(deps: EditDeps): PlaceEditor {
  return {
    async get(id) {
      const row = await deps.store.get(id)
      return row ? toDetail(row, await deps.store.brandKeys()) : null
    },
    async plan(id, edit) {
      const row = await deps.store.get(id)
      if (!row) throw new EditError('NOT_FOUND_ERROR', 404, NOT_FOUND)
      return planEdit(row, edit, deps)
    },
    apply: (id, edit, options) => applyEdit(id, edit, deps, options),
    uploadLogo: (id, image, contentType) => uploadLogo(id, image, contentType, deps),
    delete: (id) => deletePlace(id, deps),
  }
}
