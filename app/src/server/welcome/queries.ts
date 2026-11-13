import { sql, type SQL } from 'drizzle-orm'
import { SEARCH_CONFIG } from '../search/config'

/** Cuántos de los más prominentes entran al sorteo de la grilla. */
export const WELCOME_POOL = 50
/** Resultados del buscador de la bienvenida. */
export const WELCOME_SEARCH_MAX = 12

const COLUMNS = sql`p.id::text as id, p.name, p.neighborhood_id as "neighborhoodId", p.categories, p.icon_category as "iconCategory",
  p.logo_key as "logoKey", p.logo_bg_color as "logoBgColor"`

const BRAND_COUNT = sql`case when p.brand_key is null then 1
  else (select count(*)::int from places b where b.brand_key = p.brand_key and b.status = 'published') end`

/**
 * Los WELCOME_POOL publicados de mayor prominencia, sin cadenas grandes (brandCount ≥ chainMinBranches, como la
 * home) y una sola sucursal por marca (la más prominente).
 */
export function welcomePoolQuery(): SQL {
  return sql`
    select * from (
      select distinct on (coalesce(p.brand_key, p.id::text)) ${COLUMNS}, p.prominence, ${BRAND_COUNT} as "brandCount"
      from places p
      where p.status = 'published'
      order by coalesce(p.brand_key, p.id::text), p.prominence desc nulls last
    ) t
    where t."brandCount" < ${SEARCH_CONFIG.personal.chainMinBranches}
    order by t.prominence desc nulls last
    limit ${WELCOME_POOL}`
}

/**
 * Publicados cuyo nombre contiene el texto (ya normalizado: sin tildes ni mayúsculas), como el buscador del
 * backoffice (f_unaccent(lower(name)) like, con el índice trigram). Una sucursal por marca, los más prominentes primero.
 */
export function welcomeSearchQuery(normalized: string): SQL {
  const pattern = `%${normalized.replace(/[%_\\]/g, '')}%`
  return sql`
    select * from (
      select distinct on (coalesce(p.brand_key, p.id::text)) ${COLUMNS}, p.prominence
      from places p
      where p.status = 'published' and f_unaccent(lower(p.name)) like f_unaccent(lower(${pattern}))
      order by coalesce(p.brand_key, p.id::text), p.prominence desc nulls last
    ) t
    order by t.prominence desc nulls last
    limit ${WELCOME_SEARCH_MAX}`
}
