import 'server-only'
import { sql } from 'drizzle-orm'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import { getDb } from '../db'
import { SEARCH_CONFIG } from '../search/config'
import { montevideoNow, nextOpening, openStatus, type Hours } from '../search/hours'
import { DISPLAY_LANG, openStateLabel, openStateText } from '../search/labels'
import { logoUrl } from '../search/logo'
import { concreteMismatch } from '../search/personal'
import type { SearchResult } from '../search'
import type { PlaceRow } from './place'
import { placeDiscountsColumn } from '../discounts/queries'
import { cardProviders, type PlaceDiscount } from '../discounts/selection'

/** Cuántos "Parecidos a" muestra la ficha. */
export const SIMILAR_MAX = 6
/** Con menos que esto tras el corte estricto, se completa relajando (pickSimilar): la sección nunca queda con uno solo. */
export const SIMILAR_MIN = 4
/** Los más cercanos por embedding que trae la consulta antes de filtrar por corte, datos concretos y marca. */
const SIMILAR_POOL = 60

export type SimilarRow = {
  id: string
  slug: string
  name: string
  neighborhoodId: string
  categories: string[]
  tags: string[]
  style: string | null
  price: string
  hours: Hours
  iconCategory: IconCategory | null
  logoKey: string | null
  logoBgColor: string | null
  locatedIn: string | null
  brandKey: string | null
  brandCount: number
  lat: number
  lng: number
  /** Proveedor y tipo de tarjeta de cada beneficio que cuenta, para "Descuento: …" de la card. */
  discounts: PlaceDiscount[]
  similarity: number
  /** Pasa el corte de parecido (top `similar.topShare` con piso `similar.floor`). */
  strong: boolean
}

/**
 * Los SIMILAR_POOL publicados más parecidos al lugar por embedding, sin el lugar ni sus sucursales. `strong` marca los que
 * pasan el mismo corte que "Parecido a" de la búsqueda: el top `similar.topShare` de sus vecinos en toda la base, con piso
 * `similar.floor`; el resto sólo entra para completar (pickSimilar).
 */
function similarQuery(place: PlaceRow) {
  const { topShare, floor } = SEARCH_CONFIG.personal.similar
  return sql`
    with target as (select embedding from places where id::text = ${place.id} and embedding is not null),
    cut as (
      select percentile_cont(${1 - topShare}::float) within group (order by 1 - (o.embedding <=> t.embedding)) as top_cut
      from places o, target t
      where o.status = 'published' and o.embedding is not null and o.id::text <> ${place.id}
    )
    select p.id::text as id, p.slug, p.name, p.neighborhood_id as "neighborhoodId", p.categories, p.tags, p.style, p.price, p.hours,
      p.icon_category as "iconCategory", p.logo_key as "logoKey", p.logo_bg_color as "logoBgColor", p.located_in as "locatedIn",
      p.brand_key as "brandKey",
      case when p.brand_key is null then 1
        else (select count(*)::int from places b where b.brand_key = p.brand_key and b.status = 'published') end as "brandCount",
      ST_Y(p.location::geometry) as lat, ST_X(p.location::geometry) as lng,
      ${placeDiscountsColumn(sql`p.id`)} as discounts,
      1 - (p.embedding <=> t.embedding) as similarity,
      1 - (p.embedding <=> t.embedding) >= greatest(${floor}::float, coalesce((select top_cut from cut), ${floor}::float)) as strong
    from places p, target t
    where p.status = 'published' and p.embedding is not null and p.id::text <> ${place.id}
      and (${place.brand_key}::text is null or p.brand_key is distinct from ${place.brand_key})
    order by p.embedding <=> t.embedding
    limit ${SIMILAR_POOL}`
}

/**
 * Hasta SIMILAR_MAX en orden de parecido, una sucursal por marca y nunca el lugar ni su marca. Primero los que pasan el
 * corte y los datos concretos de "Parecido a" (familia de ícono o cocina en común, mismo style, precio a un nivel). Con
 * menos de SIMILAR_MIN, se completa hasta SIMILAR_MIN ampliando el rango por etapas: cualquier parecido con familia o
 * cocina en común (sin style ni precio) y, si todavía faltan, los más cercanos por embedding sin más condiciones.
 */
export function pickSimilar(place: Pick<PlaceRow, 'id' | 'brand_key' | 'icon_category' | 'tags' | 'style' | 'price'>, rows: SimilarRow[]): SimilarRow[] {
  const target = { iconCategory: place.icon_category, tags: place.tags, style: place.style, price: place.price }
  const loose = { ...target, style: null, price: '' }
  const sorted = [...rows].sort((a, b) => b.similarity - a.similarity)
  const brands = new Set<string>()
  const chosen: SimilarRow[] = []
  const fill = (limit: number, accepts: (row: SimilarRow) => boolean) => {
    for (const row of sorted) {
      if (chosen.length >= limit) return
      if (row.id === place.id || (place.brand_key && row.brandKey === place.brand_key)) continue
      if (chosen.includes(row) || (row.brandKey && brands.has(row.brandKey))) continue
      if (!accepts(row)) continue
      if (row.brandKey) brands.add(row.brandKey)
      chosen.push(row)
    }
  }
  fill(SIMILAR_MAX, (row) => row.strong && concreteMismatch(target, row) === null)
  fill(SIMILAR_MIN, (row) => concreteMismatch(loose, { ...row, style: null, price: '' }) === null)
  fill(SIMILAR_MIN, () => true)
  return chosen
}

/** Lo que necesita similarCard: también lo arman los "Guardados" de la home (server/home/saved.ts). */
export type CardRow = Pick<
  SimilarRow,
  'id' | 'slug' | 'name' | 'neighborhoodId' | 'categories' | 'hours' | 'iconCategory' | 'logoKey' | 'logoBgColor' | 'locatedIn' | 'brandCount' | 'lat' | 'lng' | 'discounts'
>

/** Una fila como resultado de la búsqueda, para la PlaceCard: el estado de horario sale de las horas de la base, ahora. */
export function similarCard(row: CardRow, now = new Date()): SearchResult {
  const moment = montevideoNow(now)
  const open = openStatus(row.hours, moment)
  const next = open.state === 'closed' ? nextOpening(row.hours, moment) : null
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    neighborhood: neighborhoodDisplayName(row.neighborhoodId) ?? row.neighborhoodId,
    categories: row.categories,
    iconCategory: row.iconCategory,
    logoKey: row.logoKey,
    logoUrl: logoUrl(row.logoKey),
    logoBgColor: row.logoBgColor,
    locatedIn: row.locatedIn,
    lat: row.lat,
    lng: row.lng,
    branchCount: row.brandCount,
    branches: [],
    reasons: [],
    discounts: cardProviders(row.discounts, []),
    openStatus: {
      state: open.state,
      closesAt: open.state === 'open' ? open.closesAt : null,
      label: openStateLabel(open, DISPLAY_LANG, moment, true, next),
      ...openStateText(open, DISPLAY_LANG, moment, true, next),
    },
    matchLevel: 'has',
    distance: null,
  }
}

/** "Parecidos a <lugar>" de la ficha. Sólo sin embedding o si la consulta falla, ninguno: la sección se oculta. */
export async function similarPlaces(place: PlaceRow, now = new Date()): Promise<SearchResult[]> {
  try {
    const { rows } = await getDb().execute(similarQuery(place))
    return pickSimilar(place, rows as SimilarRow[]).map((row) => similarCard(row, now))
  } catch (error) {
    console.warn('similarPlaces', error)
    return []
  }
}
