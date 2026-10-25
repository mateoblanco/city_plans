import { and, asc, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from '../db/schema.ts'
import type { PlaceListItem, PlaceListPage, PlaceListQuery } from '../../src/types/places.ts'
import { editedFields, parseManualOverrides } from '../../src/data/manual-overrides.ts'
import { places } from '../db/schema.ts'
import { logoUrl } from '../providers/logo-storage.ts'
import { brandSlug, instagramKey } from './brand-key.ts'
import type { InstagramOwners, ManualInstagramLookup } from '../providers/instagram-candidate-registry.ts'
import type { BrandSiblings } from '../providers/place-extraction-service.ts'

export type { PlaceListItem }

export type PlacesReader = {
  /** Una página del listado, con los filtros y el orden en la base. */
  list(query: PlaceListQuery): Promise<PlaceListPage>
  /** Cambia sólo featured (curaduría manual). false si el lugar no existe. */
  setFeatured(id: string, featured: boolean): Promise<boolean>
  /** Publica a mano un lugar en review. not_found si no existe; not_in_review si su status es otro. */
  publish(id: string): Promise<'published' | 'not_found' | 'not_in_review'>
}

/** % y _ de LIKE, escapados: la búsqueda por nombre es literal. */
const likeLiteral = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)

/** Filtros del listado salvo el status, que va aparte para contar las pestañas. */
function filtersOf(query: PlaceListQuery): SQL[] {
  const conditions: SQL[] = []
  // Contra f_unaccent(lower(name)): así Postgres usa places_name_trgm_idx.
  if (query.q) conditions.push(sql`f_unaccent(lower(${places.name})) like '%' || f_unaccent(lower(${likeLiteral(query.q)})) || '%'`)
  if (query.neighborhood) conditions.push(eq(places.neighborhoodId, query.neighborhood))
  if (query.category) conditions.push(sql`${places.categories} @> array[${query.category}]::text[]`)
  // Publicar y los motivos de revisión son decisiones de status, no edición (editedFields).
  if (query.edited) conditions.push(sql`(${places.manualOverrides} - 'status' - 'review_reasons') <> '{}'::jsonb`)
  if (query.noLogo) conditions.push(sql`${places.logoKey} is null`)
  // El mismo status que la tabla muestra como "Sin horario".
  if (query.noHours) conditions.push(sql`${places.hours}->>'status' = 'none'`)
  return conditions
}

/** Listado liviano para el backoffice: no trae embedding (1536 números) ni los textos de búsqueda. */
export function drizzlePlacesReader(db: NeonHttpDatabase<typeof schema>): PlacesReader {
  return {
    async list(query) {
      const filters = filtersOf(query)
      const where = and(...filters, ...(query.status ? [eq(places.status, query.status)] : []))
      const order = query.sort === 'prominence'
        ? [desc(places.prominence), desc(places.updatedAt)]
        : query.sort === 'name' ? [asc(sql`f_unaccent(lower(${places.name}))`), asc(places.id)] : [desc(places.updatedAt), asc(places.id)]
      const [rows, [counts]] = await Promise.all([
        db
          .select({
            id: places.id,
            name: places.name,
            neighborhoodId: places.neighborhoodId,
            categories: places.categories,
            tags: places.tags,
            status: places.status,
            reviewReasons: places.reviewReasons,
            hoursStatus: sql<string>`${places.hours}->>'status'`,
            updatedAt: places.updatedAt,
            hasEmbedding: sql<boolean>`${places.embedding} is not null`,
            prominence: places.prominence,
            igFollowers: places.igFollowers,
            brandKey: places.brandKey,
            instagram: places.instagram,
            featured: places.featured,
            logoKey: places.logoKey,
            logoKind: places.logoKind,
            logoBgColor: places.logoBgColor,
            logoColor: places.logoColor,
            iconCategory: places.iconCategory,
            style: places.style,
            manualOverrides: places.manualOverrides,
            total: sql<number>`(count(*) over())::int`,
          })
          .from(places)
          .where(where)
          .orderBy(...order)
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        db
          .select({
            all: sql<number>`count(*)::int`,
            published: sql<number>`(count(*) filter (where ${places.status} = 'published'))::int`,
            review: sql<number>`(count(*) filter (where ${places.status} = 'review'))::int`,
          })
          .from(places)
          .where(and(...filters)),
      ])
      return {
        places: rows.map(({ logoKey, manualOverrides, total: _total, ...row }) => ({
          ...row,
          instagram: instagramKey(row.instagram),
          updatedAt: row.updatedAt.toISOString(),
          logoUrl: logoUrl(logoKey),
          editedFields: editedFields(parseManualOverrides(manualOverrides)),
        })),
        // Una página vacía (más allá del final) no trae el total por la ventana: se toma de los conteos.
        total: rows[0]?.total ?? (query.status ? counts[query.status] : counts.all),
        counts,
      }
    },
    async setFeatured(id, featured) {
      // Curaduría, no contenido: updatedAt no cambia y el lugar no sube en "más reciente".
      const updated = await db.update(places).set({ featured, updatedAt: places.updatedAt }).where(eq(places.id, id)).returning({ id: places.id })
      return updated.length > 0
    },
    async publish(id) {
      // Decisión manual: status va a manual_overrides para que otra extracción no lo vuelva a mandar a revisión.
      // Como el destacado, no cambia updatedAt.
      const updated = await db.update(places)
        .set({
          status: 'published',
          manualOverrides: sql`${places.manualOverrides} || '{"status":"published"}'::jsonb`,
          updatedAt: places.updatedAt,
        })
        .where(and(eq(places.id, id), eq(places.status, 'review')))
        .returning({ id: places.id })
      if (updated.length > 0) return 'published'
      const found = await db.select({ id: places.id }).from(places).where(eq(places.id, id))
      return found.length > 0 ? 'not_in_review' : 'not_found'
    },
  }
}

/** Lugares guardados con alguno de los handles de Instagram (sin @ ni mayúsculas), salvo el que se está procesando. */
export function drizzleInstagramOwners(db: NeonHttpDatabase<typeof schema>): InstagramOwners {
  return async (handles, exceptPlaceId) => {
    if (handles.length === 0) return []
    const handle = sql<string>`lower(regexp_replace(${places.instagram}, '^@', ''))`
    const rows = await db
      .select({ handle, googlePlaceId: places.googlePlaceId, name: places.name })
      .from(places)
      .where(and(inArray(handle, handles.map((item) => item.toLowerCase())), ne(places.googlePlaceId, exceptPlaceId)))
    return rows.flatMap((row) => row.googlePlaceId ? [{ handle: row.handle, googlePlaceId: row.googlePlaceId, name: row.name }] : [])
  }
}

/**
 * ¿Hay otro lugar guardado de la misma marca? Mismo Instagram, la brand_key guardada de este lugar o el slug de la
 * marca como brand_key.
 */
export function drizzleBrandSiblings(db: NeonHttpDatabase<typeof schema>): BrandSiblings {
  return async ({ googlePlaceId, instagram, brand }) => {
    const [self] = await db.select({ brandKey: places.brandKey }).from(places).where(eq(places.googlePlaceId, googlePlaceId)).limit(1)
    const handle = instagramKey(instagram)
    const keys = [...new Set([self?.brandKey, brandSlug(brand)].flatMap((key) => key ?? []))]
    const conditions: SQL[] = [
      ...(handle ? [eq(sql`lower(regexp_replace(${places.instagram}, '^@', ''))`, handle)] : []),
      ...(keys.length ? [inArray(places.brandKey, keys)] : []),
    ]
    if (conditions.length === 0) return false
    const rows = await db.select({ id: places.id }).from(places)
      .where(and(or(...conditions), ne(places.googlePlaceId, googlePlaceId)))
      .limit(1)
    return rows.length > 0
  }
}

/** El Instagram cargado a mano del lugar (manual_overrides.instagram): el handle, o null si no tiene. */
export function drizzleManualInstagram(db: NeonHttpDatabase<typeof schema>): ManualInstagramLookup {
  return async (googlePlaceId) => {
    const [row] = await db
      .select({ manualOverrides: places.manualOverrides })
      .from(places)
      .where(eq(places.googlePlaceId, googlePlaceId))
      .limit(1)
    const overrides = parseManualOverrides(row?.manualOverrides)
    if (!Object.hasOwn(overrides, 'instagram')) return null
    return { handle: overrides.instagram ?? null }
  }
}
