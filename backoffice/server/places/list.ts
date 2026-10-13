import { desc, eq, sql } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from '../db/schema.ts'
import { places } from '../db/schema.ts'

export type PlaceListItem = {
  id: string
  name: string
  neighborhoodId: string
  categories: string[]
  tags: string[]
  status: string
  hoursStatus: string
  updatedAt: string
  hasEmbedding: boolean
  prominence: number
  editorialMentions: number
  listedOrAwarded: boolean
  igFollowers: number | null
  featured: boolean
}

export type PlacesReader = {
  list(): Promise<PlaceListItem[]>
  /** Cambia sólo featured (curaduría manual). false si el lugar no existe. */
  setFeatured(id: string, featured: boolean): Promise<boolean>
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
          hoursStatus: sql<string>`${places.hours}->>'status'`,
          updatedAt: places.updatedAt,
          hasEmbedding: sql<boolean>`${places.embedding} is not null`,
          prominence: places.prominence,
          editorialMentions: places.editorialMentions,
          listedOrAwarded: places.listedOrAwarded,
          igFollowers: places.igFollowers,
          featured: places.featured,
        })
        .from(places)
        .orderBy(desc(places.updatedAt))
      return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
    },
    async setFeatured(id, featured) {
      // Curaduría, no contenido: updatedAt no cambia y el lugar no sube en "más reciente".
      const updated = await db.update(places).set({ featured, updatedAt: places.updatedAt }).where(eq(places.id, id)).returning({ id: places.id })
      return updated.length > 0
    },
  }
}
