import { asc, inArray, or, sql } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { fold } from '../../src/lib/discount-names.ts'
import type { OurPlaceOption } from '../../src/types/discounts.ts'
import type * as schema from '../db/schema.ts'
import { places } from '../db/schema.ts'
import { brandSlug, instagramKey } from '../places/brand-key.ts'
import { logoUrl } from '../providers/logo-storage.ts'

// Nuestros lugares para el panel «Resolver»: todos los status (publicados, en revisión, ocultos y borradores).

export type OurPlaceRow = Omit<OurPlaceOption, 'meters' | 'score' | 'reason'> & { location: { lat: number; lng: number } | null }

export type OurPlacesReader = {
  /** Búsqueda parcial sin tildes ni mayúsculas por nombre, Instagram (con o sin @) o marca (brand_key). */
  search(q: string, limit: number): Promise<OurPlaceRow[]>
  byIds(ids: string[]): Promise<OurPlaceRow[]>
}

export const OUR_PLACES_LIMIT = 20

/** El texto de la búsqueda: sin tildes ni mayúsculas; el handle de Instagram sin @ ni espacios; el slug de la marca. */
export function ourPlacesQuery(q: string) {
  const text = fold(q)
  return { text, handle: instagramKey(text.replace(/\s+/g, '')) ?? '', brand: brandSlug(q) }
}

/** La misma regla que la consulta de Drizzle, para el store en memoria (tests). Exacto > empieza con > contiene. */
export function matchRank(row: Pick<OurPlaceRow, 'name' | 'instagram' | 'brandKey'>, q: string): number | null {
  const { text, handle, brand } = ourPlacesQuery(q)
  if (!text) return null
  const name = fold(row.name)
  if (name === text) return 0
  if (name.startsWith(text)) return 1
  if (name.includes(text)) return 2
  if (handle && instagramKey(row.instagram)?.includes(handle)) return 3
  if (brand && row.brandKey?.includes(brand)) return 3
  return null
}

const likeLiteral = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`)

export function drizzleOurPlaces(db: NeonHttpDatabase<typeof schema>): OurPlacesReader {
  const columns = {
    id: places.id, name: places.name, neighborhoodId: places.neighborhoodId, categories: places.categories, status: places.status,
    instagram: places.instagram, brandKey: places.brandKey, logoKey: places.logoKey, location: places.location,
  }
  type Selected = { logoKey: string | null; instagram: string | null } & Omit<OurPlaceRow, 'logoUrl' | 'instagram'>
  const toRow = ({ logoKey, ...row }: Selected): OurPlaceRow => ({ ...row, instagram: instagramKey(row.instagram), logoUrl: logoUrl(logoKey) })
  return {
    async search(q, limit) {
      const { text, handle, brand } = ourPlacesQuery(q)
      if (!text) return []
      // Contra f_unaccent(lower(name)): así Postgres usa places_name_trgm_idx.
      const name = sql`f_unaccent(lower(${places.name}))`
      const needle = likeLiteral(text)
      const rows = await db.select(columns).from(places)
        .where(or(
          sql`${name} like '%' || f_unaccent(${needle}) || '%'`,
          ...(handle ? [sql`lower(regexp_replace(${places.instagram}, '^@', '')) like '%' || ${likeLiteral(handle)} || '%'`] : []),
          ...(brand ? [sql`${places.brandKey} like '%' || ${likeLiteral(brand)} || '%'`] : []),
        ))
        .orderBy(sql`case when ${name} = f_unaccent(${text}) then 0 when ${name} like f_unaccent(${needle}) || '%' then 1 when ${name} like '%' || f_unaccent(${needle}) || '%' then 2 else 3 end`, asc(name), asc(places.id))
        .limit(limit)
      return rows.map((row) => toRow(row as Selected))
    },
    async byIds(ids) {
      if (!ids.length) return []
      const rows = await db.select(columns).from(places).where(inArray(places.id, ids))
      return rows.map((row) => toRow(row as Selected))
    },
  }
}

/** En memoria, con las mismas reglas (tests de los endpoints). */
export function memoryOurPlaces(rows: OurPlaceRow[]): OurPlacesReader {
  return {
    async search(q, limit) {
      return rows
        .flatMap((row) => {
          const rank = matchRank(row, q)
          return rank === null ? [] : [{ row, rank }]
        })
        .sort((a, b) => a.rank - b.rank || fold(a.row.name).localeCompare(fold(b.row.name)) || a.row.id.localeCompare(b.row.id))
        .slice(0, limit)
        .map((item) => item.row)
    },
    async byIds(ids) {
      return rows.filter((row) => ids.includes(row.id))
    },
  }
}
