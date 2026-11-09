import 'server-only'
import { cache } from 'react'
import { sql } from 'drizzle-orm'
import type { IconCategory } from '@shared/icon-categories.ts'
import type { Hours } from '../search/hours'
import { getDb } from '../db'

/** Fila de places tal como está en la base, sin los textos de búsqueda ni el embedding; lat y lng salen de location. */
export type PlaceRow = Record<string, unknown> & {
  id: string
  slug: string
  name: string
  neighborhood_id: string
  description_es: string | null
  google_place_id: string | null
  categories: string[]
  tags: string[]
  diet_vegan: string
  diet_vegetarian: string
  diet_gluten_free: string
  price: string
  hours: Hours
  instagram: string | null
  highlights: { es?: string; en?: string }[]
  located_in: string | null
  /** Líneas de ómnibus con parada cerca: una fila por línea y parada, con la distancia en metros. */
  transit_lines: { line: string; stopId: string; meters: number }[]
  brand_key: string | null
  icon_category: IconCategory | null
  style: string | null
  logo_key: string | null
  logo_bg_color: string | null
  lat: number
  lng: number
}

/** Otra sucursal publicada de la misma marca. */
export type BranchRow = { id: string; slug: string; neighborhoodId: string; googlePlaceId: string | null }

const SLUG = /^[a-z0-9-]{1,200}$/
const DESCRIPTION_MAX = 155

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug)
}

/** description_es para la meta description: hasta 155 caracteres, cortada en una palabra. undefined si está vacía. */
export function metaDescription(text: string | null): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined
  if (clean.length <= DESCRIPTION_MAX) return clean
  const cut = clean.slice(0, DESCRIPTION_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, '')}…`
}

// cache de React: generateMetadata y la página comparten una consulta por request. Nada se guarda entre requests.
// search_tsv sale de keyword_text (el mismo texto en tokens), así que tampoco va.
export const getPublishedPlace = cache(async (slug: string): Promise<PlaceRow | null> => {
  if (!isValidSlug(slug)) return null
  const { rows } = await getDb().execute(sql`
    select to_jsonb(p) - 'embedding' - 'embedding_text' - 'keyword_text' - 'search_tsv' - 'location'
      || jsonb_build_object('lat', ST_Y(p.location::geometry), 'lng', ST_X(p.location::geometry)) as row
    from places p
    where p.slug = ${slug} and p.status = 'published'
    limit 1
  `)
  return ((rows[0] as { row: PlaceRow } | undefined)?.row) ?? null
})

/** Las otras sucursales publicadas de la marca (sin el lugar actual), por barrio. Sin marca, ninguna. */
export async function getBranches(brandKey: string | null, placeId: string): Promise<BranchRow[]> {
  if (!brandKey) return []
  const { rows } = await getDb().execute(sql`
    select id::text as id, slug, neighborhood_id as "neighborhoodId", google_place_id as "googlePlaceId"
    from places
    where brand_key = ${brandKey} and status = 'published' and id::text <> ${placeId}
    order by neighborhood_id, name
  `)
  return rows as BranchRow[]
}
