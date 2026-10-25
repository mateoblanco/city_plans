import { sql, type SQL } from 'drizzle-orm'
import { SEARCH_CONFIG } from './config'
import type { DishTarget } from './dishes'
import { opensTodayFrom, type Hours, type Moment, type OpenFilter } from './hours'
import type { DietKey, Price } from './interpretation'
import type { IntentMatch } from '@shared/intents.ts'
import type { IconCategory } from '@shared/icon-categories.ts'

/** Filtros duros: lo que un lugar tiene que cumplir para ser candidato. */
export type CandidateFilters = {
  categories: string[]
  tags: string[]
  diet: DietKey[]
  neighborhoods: string[]
  price: Price[]
  openAt: OpenFilter | null
  excludeCategories: string[]
  excludeTags: string[]
  dishes: DishTarget[]
  /**
   * dish: el plato en dishes o en el texto, o su tag/categoría propios.
   * related: ningún lugar tiene el plato; se busca por sus tags relacionados.
   * none: sin filtro de plato (último recurso por similitud).
   */
  dishMode: DishMode
  /** Cerca mío: sólo lugares a menos de radiusM metros. */
  near: { lat: number; lng: number; radiusM: number } | null
  /**
   * Intención, sub-filtros y la sección de "Ver todos": cada grupo es "cualquiera de" (categorías, tags, featured,
   * style); entre grupos, "y".
   */
  groups: FilterGroup[]
}

/** Un grupo de filtros: el match de una intención o sub-filtro, o la regla de una sección (que puede pedir style o íconos). */
export type FilterGroup = IntentMatch & { style?: string; icons?: string[] }

export type DishMode = 'dish' | 'related' | 'none'

/** Entradas de los rankings, que se calculan sobre los candidatos en la misma consulta. */
export type ScoreInputs = {
  embedding: number[] | null
  /** Palabras ya normalizadas que van unidas con | en to_tsquery. */
  keywords: string[]
  /** Consulta de nombre ya normalizada (minúscula, sin acentos). */
  name: string | null
  /** Desde dónde se mide la distancia: la ubicación de la persona o los centros de barrio al relajarlo. */
  origins: { lat: number; lng: number }[]
  /** Lugar fijado por nombre: entra aunque no cumpla los filtros. */
  pinnedId: string | null
}

export type CandidateRow = {
  id: string
  slug: string
  name: string
  neighborhoodId: string
  categories: string[]
  tags: string[]
  signature: string[]
  dishes: string[]
  /** Estilo de la marca (casual, intermedio, cuidado); null sin señales. */
  style: string | null
  diet: Record<DietKey, string>
  price: string
  hours: Hours
  /** Señal de calidad del backoffice (0 a 1). Sólo reordena; nunca se muestra. */
  prominence: number
  /** Curaduría manual. */
  featured: boolean
  /** Clave de shared/icon-categories.ts; null = todavía sin categoría. */
  iconCategory: IconCategory | null
  /** Clave del logo en R2 (null = sin logo); la URL la arma logoUrl. */
  logoKey: string | null
  /** Color de fondo del logo (#rrggbb) o null. */
  logoBgColor: string | null
  /** Marca con sucursales (backoffice: server/places/brand-key.ts); null = sin marca. */
  brandKey: string | null
  /** Sucursales publicadas de la marca, aunque no cumplan la búsqueda; 1 sin marca. */
  brandCount: number
  lat: number
  lng: number
  matchesFilters: boolean
  semantic: number | null
  keyword: number
  nameScore: number
  distance: number | null
  /** Por plato pedido (mismo orden): está en dishes o en el texto del lugar. */
  dishHas: boolean[]
  /** Por plato pedido: está exacto en dishes. */
  dishExact: boolean[]
}

const DIET_COLUMN: Record<DietKey, string> = { vegan: 'diet_vegan', vegetarian: 'diet_vegetarian', glutenFree: 'diet_gluten_free' }
const textArray = (values: string[]) => sql`${sql.param(values)}::text[]`
const likePattern = (value: string) => `%${value.replace(/[%_\\]/g, '')}%`

// Texto propio del lugar (no keyword_text, que repite los sinónimos de cada tag).
const PLACE_TEXT = sql`f_unaccent(lower(coalesce(description_es, '') || ' ' || coalesce(description_en, '') || ' ' || highlights::text))`

function dishHasSql(dish: string): SQL {
  const pattern = likePattern(dish)
  return sql`(exists (select 1 from unnest(dishes) d where f_unaccent(lower(d)) like f_unaccent(lower(${pattern}))) or ${PLACE_TEXT} like f_unaccent(lower(${pattern})))`
}

function dishExactSql(dish: string): SQL {
  return sql`exists (select 1 from unnest(dishes) d where f_unaccent(lower(d)) = f_unaccent(lower(${dish})))`
}

/** Misma regla que openStatus(): cruces de medianoche, closes null y horarios sin confirmar que no se excluyen. */
export function openAtSql(moment: Moment): SQL {
  const unconfirmed = sql`(hours->>'status' not in ('exact', 'partial') or jsonb_array_length(hours->'slots') = 0)`
  if (moment.time === null) {
    return sql`(${unconfirmed} or exists (select 1 from jsonb_array_elements(hours->'slots') s where (s->>'day')::int = ${moment.day}))`
  }
  const previousDay = (moment.day + 6) % 7
  return sql`(${unconfirmed} or exists (
    select 1 from jsonb_array_elements(hours->'slots') s
    where ((s->>'day')::int = ${moment.day} and s->>'opens' <= ${moment.time}
           and (s->>'closes' is null or s->>'closes' <= s->>'opens' or ${moment.time} < s->>'closes'))
       or ((s->>'day')::int = ${previousDay} and s->>'closes' is not null
           and s->>'closes' <= s->>'opens' and ${moment.time} < s->>'closes')
  ))`
}

/** "Abre hoy", misma regla que opensToday(): abierto desde ya (o desde la noche), o un turno de hoy que abre más tarde. */
export function opensTodaySql(moment: { day: number; time: string }, night = false): SQL {
  const from = opensTodayFrom(moment.time, night)
  const nightFrom = SEARCH_CONFIG.night.from
  const reachesNight = night
    ? sql` and (s->>'closes' is null or s->>'closes' <= s->>'opens' or s->>'closes' > ${nightFrom})`
    : sql``
  return sql`(${openAtSql({ day: moment.day, time: from })} or exists (
    select 1 from jsonb_array_elements(hours->'slots') s
    where (s->>'day')::int = ${moment.day} and s->>'opens' > ${from}${reachesNight}
  ))`
}

function groupSql(group: FilterGroup): SQL {
  const options: SQL[] = []
  if (group.categories?.length) options.push(sql`categories && ${textArray(group.categories)}`)
  if (group.tags?.length) options.push(sql`tags && ${textArray(group.tags)}`)
  if (group.featured) options.push(sql`featured`)
  if (group.style) options.push(sql`style = ${group.style}`)
  if (group.icons?.length) options.push(sql`icon_category = any(${textArray(group.icons)})`)
  for (const pair of group.all ?? []) options.push(sql`(categories && ${textArray(pair.categories)} and tags && ${textArray(pair.tags)})`)
  return options.length ? sql`(${sql.join(options, sql` or `)})` : sql`false`
}

const pointSql = ({ lat, lng }: { lat: number; lng: number }) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`

export function filterConditions(filters: CandidateFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters.categories.length) conditions.push(sql`categories && ${textArray(filters.categories)}`)
  if (filters.tags.length) conditions.push(sql`tags @> ${textArray(filters.tags)}`)
  for (const key of filters.diet) conditions.push(sql`${sql.identifier(DIET_COLUMN[key])} in ('has_options', 'fully')`)
  if (filters.neighborhoods.length) conditions.push(sql`neighborhood_id = any(${textArray(filters.neighborhoods)})`)
  // Precio desconocido no excluye: sólo afuera los que tienen otro precio conocido.
  if (filters.price.length) conditions.push(sql`(price = 'unknown' or price = any(${textArray(filters.price)}))`)
  if (filters.openAt) {
    const { moment, today, night } = filters.openAt
    conditions.push(today && moment.time ? opensTodaySql({ day: moment.day, time: moment.time }, night) : openAtSql(moment))
  }
  if (filters.near) conditions.push(sql`ST_DWithin(location, ${pointSql(filters.near)}, ${filters.near.radiusM})`)
  for (const group of filters.groups) conditions.push(groupSql(group))
  if (filters.excludeCategories.length) conditions.push(sql`not (categories && ${textArray(filters.excludeCategories)})`)
  if (filters.excludeTags.length) conditions.push(sql`not (tags && ${textArray(filters.excludeTags)})`)
  if (filters.dishes.length && filters.dishMode === 'related') {
    const related = filters.dishes.flatMap((target) => [
      ...(target.related.tags.length ? [sql`tags && ${textArray(target.related.tags)}`] : []),
      ...(target.related.categories.length ? [sql`categories && ${textArray(target.related.categories)}`] : []),
    ])
    conditions.push(related.length ? sql`(${sql.join(related, sql` or `)})` : sql`false`)
  }
  if (filters.dishes.length && filters.dishMode === 'dish') {
    // Alcanza con uno de los platos pedidos: lo tiene, o tiene el tag o la categoría relacionados.
    const anyDish = filters.dishes.map((target) => {
      const options = [dishHasSql(target.dish)]
      if (target.tag) options.push(sql`tags && ${textArray([target.tag])}`)
      if (target.category) options.push(sql`categories && ${textArray([target.category])}`)
      return sql`(${sql.join(options, sql` or `)})`
    })
    conditions.push(sql`(${sql.join(anyDish, sql` or `)})`)
  }
  return conditions
}

/** 5 decimales: el error en el coseno es del orden de 1e-5, despreciable para ordenar. */
export function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((value) => Number(value.toFixed(5))).join(',')}]`
}

export function candidatesQuery(filters: CandidateFilters, scores: ScoreInputs): SQL {
  const conditions = filterConditions(filters)
  const matches = conditions.length ? sql.join(conditions, sql` and `) : sql`true`
  // El vector viaja una sola vez (CTE) y redondeado: así el request baja de ~58 KB a ~13 KB.
  const vector = scores.embedding ? sql`(select v from query_vector)` : null
  const withVector = scores.embedding ? sql`with query_vector as (select ${vectorLiteral(scores.embedding)}::vector as v) ` : sql``
  const tsQuery = scores.keywords.length ? scores.keywords.join(' | ') : null
  const nameExpression = sql`f_unaccent(lower(name))`

  const semantic = vector ? sql`1 - (embedding <=> ${vector})` : sql`null::float`
  const keyword = tsQuery ? sql`ts_rank(search_tsv, to_tsquery('simple', ${tsQuery}))` : sql`0::real`
  const nameScore = scores.name
    ? sql`greatest(similarity(${nameExpression}, ${scores.name}), word_similarity(${scores.name}, ${nameExpression}))`
    : sql`0::real`
  const distance = scores.origins.length
    ? sql`least(${sql.join(
        scores.origins.map((origin) => sql`ST_Distance(location, ${pointSql(origin)})`),
        sql`, `,
      )})`
    : sql`null::float`
  const dishHas = filters.dishes.length ? sql`array[${sql.join(filters.dishes.map((target) => dishHasSql(target.dish)), sql`, `)}]` : sql`'{}'::boolean[]`
  const dishExact = filters.dishes.length ? sql`array[${sql.join(filters.dishes.map((target) => dishExactSql(target.dish)), sql`, `)}]` : sql`'{}'::boolean[]`
  const order = vector ? sql`embedding <=> ${vector}` : tsQuery ? sql`${keyword} desc` : sql`name`
  const pinned = scores.pinnedId ? sql` or id = ${scores.pinnedId}` : sql``

  return sql`
    ${withVector}select id, slug, name, neighborhood_id as "neighborhoodId", categories, tags, signature, dishes,
      json_build_object('vegan', diet_vegan, 'vegetarian', diet_vegetarian, 'glutenFree', diet_gluten_free) as diet,
      price, style, hours, prominence, featured, icon_category as "iconCategory",
      logo_key as "logoKey", logo_bg_color as "logoBgColor", brand_key as "brandKey",
      case when brand_key is null then 1
        else (select count(*)::int from places b where b.brand_key = places.brand_key and b.status = 'published') end as "brandCount",
      ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng,
      (${matches}) as "matchesFilters",
      ${semantic} as semantic,
      ${keyword} as keyword,
      ${nameScore} as "nameScore",
      ${distance} as distance,
      ${dishHas} as "dishHas",
      ${dishExact} as "dishExact"
    from places
    where status = 'published' and ((${matches})${pinned})
    order by ${order}
    limit ${SEARCH_CONFIG.candidateLimit}`
}

/** Cuántos publicados cumplen los filtros: para explicar un resultado vacío. */
export function countQuery(filters: CandidateFilters): SQL {
  const conditions = filterConditions(filters)
  return sql`select count(*)::int as count from places where status = 'published'${conditions.length ? sql` and ${sql.join(conditions, sql` and `)}` : sql``}`
}

export type NameMatch = { id: string; name: string; similarity: number; wordSimilarity: number }

/** Mejores coincidencias por nombre entre todos los publicados, con los operadores que usa el índice trigram. */
export function nameMatchQuery(name: string, limit = 3): SQL {
  const expression = sql`f_unaccent(lower(name))`
  return sql`
    select id, name, similarity(${expression}, ${name}) as similarity, word_similarity(${name}, ${expression}) as "wordSimilarity"
    from places
    where status = 'published' and (${expression} % ${name} or ${name} <% ${expression})
    order by greatest(similarity(${expression}, ${name}), word_similarity(${name}, ${expression})) desc
    limit ${limit}`
}

/** Barrios con al menos un lugar publicado, para el filtro de la barra. */
export function neighborhoodsQuery(): SQL {
  return sql`select distinct neighborhood_id as id from places where status = 'published' order by 1`
}
