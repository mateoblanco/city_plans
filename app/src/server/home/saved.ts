import { sql, type SQL } from 'drizzle-orm'
import { similarCard, type CardRow } from '../places/similar'
import { placeDiscountsColumn } from '../discounts/queries'
import type { HomeRow } from './assemble'

export const SAVED_ROW = { id: 'saved', title: 'Guardados' } as const

/** Los guardados que siguen publicados (los borrados o despublicados no vuelven), con lo que necesita la card. */
export function savedPlacesQuery(ids: string[]): SQL {
  return sql`
    select p.id::text as id, p.slug, p.name, p.neighborhood_id as "neighborhoodId", p.categories, p.hours,
      p.icon_category as "iconCategory", p.logo_key as "logoKey", p.logo_bg_color as "logoBgColor", p.located_in as "locatedIn",
      case when p.brand_key is null then 1
        else (select count(*)::int from places b where b.brand_key = p.brand_key and b.status = 'published') end as "brandCount",
      ST_Y(p.location::geometry) as lat, ST_X(p.location::geometry) as lng,
      ${placeDiscountsColumn(sql`p.id`)} as discounts
    from places p
    where p.status = 'published' and p.id::text = any(${sql.param(ids)}::text[])`
}

export type SavedDeps = { savedPlaces(ids: string[]): Promise<CardRow[]> }

/**
 * "Guardados" de la home con los ids de la cookie (ya validados, del más reciente al más viejo): todos, en ese orden,
 * sin filtrar por horario ni sacar cadenas, y sin "Ver todos". Los que ya no existen o no están publicados se ignoran.
 * null si no queda ninguno (la fila no se muestra). No pasa por assembleHome: no participa de la regla de no repetir.
 */
export async function homeSavedRow(deps: SavedDeps, ids: string[], now?: Date): Promise<HomeRow | null> {
  if (ids.length === 0) return null
  const byId = new Map((await deps.savedPlaces(ids)).map((row) => [row.id, row]))
  const places = ids.flatMap((id) => {
    const row = byId.get(id)
    return row ? [similarCard(row, now)] : []
  })
  return places.length === 0 ? null : { ...SAVED_ROW, places, href: null }
}
