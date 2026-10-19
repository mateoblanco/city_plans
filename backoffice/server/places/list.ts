import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from '../db/schema.ts'
import type { IconCategory } from '../../src/data/icon-categories.ts'
import type { StyleId } from '../../src/data/tags.ts'
import type { ReviewReason } from '../../src/data/review-reasons.ts'
import type { PlaceLogo } from '../../src/types/places.ts'
import { places } from '../db/schema.ts'
import { logoUrl } from '../providers/logo-storage.ts'
import type { InstagramOwners } from '../providers/instagram-candidate-registry.ts'

export type PlaceListItem = {
  id: string
  name: string
  neighborhoodId: string
  categories: string[]
  tags: string[]
  status: string
  reviewReasons: ReviewReason[]
  hoursStatus: string
  updatedAt: string
  hasEmbedding: boolean
  prominence: number
  igFollowers: number | null
  featured: boolean
  logoUrl: string | null
  logoKind: PlaceLogo['kind']
  logoBgColor: string | null
  logoColor: string | null
  iconCategory: IconCategory | null
  style: StyleId | null
}

export type PlacesReader = {
  list(): Promise<PlaceListItem[]>
  /** Cambia sólo featured (curaduría manual). false si el lugar no existe. */
  setFeatured(id: string, featured: boolean): Promise<boolean>
  /** Publica a mano un lugar en review. not_found si no existe; not_in_review si su status es otro. */
  publish(id: string): Promise<'published' | 'not_found' | 'not_in_review'>
}

/** Listado liviano para el backoffice: no trae embedding (1536 números) ni los textos de búsqueda. */
export function drizzlePlacesReader(db: NeonHttpDatabase<typeof schema>): PlacesReader {
  return {
    async list() {
      const rows = await db
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
          featured: places.featured,
          logoKey: places.logoKey,
          logoKind: places.logoKind,
          logoBgColor: places.logoBgColor,
          logoColor: places.logoColor,
          iconCategory: places.iconCategory,
          style: places.style,
        })
        .from(places)
        .orderBy(desc(places.updatedAt))
      return rows.map(({ logoKey, ...row }) => ({ ...row, updatedAt: row.updatedAt.toISOString(), logoUrl: logoUrl(logoKey) }))
    },
    async setFeatured(id, featured) {
      // Curaduría, no contenido: updatedAt no cambia y el lugar no sube en "más reciente".
      const updated = await db.update(places).set({ featured, updatedAt: places.updatedAt }).where(eq(places.id, id)).returning({ id: places.id })
      return updated.length > 0
    },
    async publish(id) {
      // Decisión manual: "status" va a manualOverrides para que otra extracción no lo vuelva a mandar a revisión.
      // Como el destacado, no cambia updatedAt.
      const updated = await db.update(places)
        .set({
          status: 'published',
          manualOverrides: sql`case when 'status' = any(${places.manualOverrides}) then ${places.manualOverrides} else array_append(${places.manualOverrides}, 'status') end`,
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
