import { desc, sql } from 'drizzle-orm'
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
}

export type PlacesReader = {
  list(): Promise<PlaceListItem[]>
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
        })
        .from(places)
        .orderBy(desc(places.updatedAt))
      return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
    },
  }
}
