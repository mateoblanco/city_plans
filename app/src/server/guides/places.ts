import type { IconCategory } from '@shared/icon-categories.ts'
import type { Hours } from '../search/hours'
import type { GuidePhoto, GuidePlaceEntry } from './types'

/** Lo que la guía lee de cada lugar: sólo datos propios de la tabla places (nunca nada de Google). */
export type GuidePlaceRow = {
  id: string
  slug: string
  name: string
  neighborhoodId: string
  categories: string[]
  iconCategory: IconCategory | null
  logoKey: string | null
  logoBgColor: string | null
  hours: Hours
  lat: number
  lng: number
}

/** Los lugares de la guía que siguen publicados (los borrados o despublicados no vuelven). */
export const GUIDE_PLACES_SQL = `
  select p.id::text as id, p.slug, p.name, p.neighborhood_id as "neighborhoodId", p.categories, p.icon_category as "iconCategory",
    p.logo_key as "logoKey", p.logo_bg_color as "logoBgColor", p.hours,
    ST_Y(p.location::geometry) as lat, ST_X(p.location::geometry) as lng
  from places p
  where p.status = 'published' and p.id::text = any($1::text[])`

export type AssembledGuidePlace = { number: number; text: string; photo: GuidePhoto | null; row: GuidePlaceRow }

/**
 * En el orden del archivo, sólo los que volvieron de la base (publicados), sin repetir, numerados de nuevo desde 1: si
 * un lugar se despublica, sale de la guía sin error y los de abajo suben un número.
 */
export function assembleGuidePlaces(entries: readonly GuidePlaceEntry[], rows: readonly GuidePlaceRow[]): AssembledGuidePlace[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const seen = new Set<string>()
  const kept = entries.flatMap((entry) => {
    const row = byId.get(entry.id)
    if (!row || seen.has(entry.id)) return []
    seen.add(entry.id)
    return [{ entry, row }]
  })
  return kept.map(({ entry, row }, index) => ({ number: index + 1, text: entry.text, photo: entry.photo ?? null, row }))
}
