import 'server-only'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import type { SearchResult } from '../search'
import { logoUrl } from '../search/logo'
import { getBranches, getPublishedPlace, type PlaceRow } from './place'
import { similarPlaces } from './similar'
import { placeDiscounts, type PlaceDiscountProvider } from '../discounts'
import type { GuideLink } from '../guides/entries'
import { getPlaceGuides } from '../guides/place-data'

/** Otra sucursal en la ficha: sólo datos de la base (sin dirección: la calle es de Google y el servidor no lo llama). */
export type BranchCardData = { id: string; slug: string; neighborhood: string }

/**
 * Sólo datos propios: nada de Google (lo pide el navegador a /api/place-google/[id]). La fila y los descuentos llegan
 * resueltos; las sucursales y los parecidos, como promesas ya lanzadas, cada una en su <Suspense> al final de la
 * página. Ninguna rechaza.
 */
export type PlacePageData = {
  place: PlaceRow
  neighborhood: string
  logoUrl: string | null
  /** Otras sucursales publicadas de la marca. */
  branches: Promise<BranchCardData[]>
  similar: Promise<SearchResult[]>
  /** Descuentos que cuentan, por proveedor (orden de la config); [] sin descuentos o si falla la consulta. */
  discounts: PlaceDiscountProvider[]
  /** "Aparece en estas guías": las guías publicadas que lo incluyen (cacheadas); [] si ninguna o si falla. */
  guides: GuideLink[]
}

const neighborhoodName = (id: string) => neighborhoodDisplayName(id) ?? id

/**
 * Todo lo de la ficha que es nuestro: la fila de la base y los descuentos (van debajo del mapa y, si llegaran después,
 * moverían lo de abajo) y, lanzados en paralelo sin esperarlos, las sucursales y los parecidos. Nunca llama a Google.
 * null si el lugar no existe o no está publicado.
 */
export async function getPlacePage(slug: string): Promise<PlacePageData | null> {
  const place = await getPublishedPlace(slug)
  if (!place) return null

  const branches = getBranches(place.brand_key, place.id)
    .catch((error) => {
      console.warn('getBranches', error)
      return []
    })
    .then((rows) => rows.map((row) => ({ id: row.id, slug: row.slug, neighborhood: neighborhoodName(row.neighborhoodId) })))
  // similarPlaces no tira (si falla, []).
  const similar = similarPlaces(place)
  // Descuentos y guías van debajo del resumen: se esperan (si llegaran después, moverían lo de abajo). Las guías salen
  // de la lista cacheada (getPlaceGuides), así que no demoran.
  const [discounts, guides] = await Promise.all([
    placeDiscounts(place.id).catch((error) => {
      console.warn('placeDiscounts', error)
      return []
    }),
    getPlaceGuides(place.id).catch((error) => {
      console.warn('getPlaceGuides', error)
      return [] as GuideLink[]
    }),
  ])

  return {
    place,
    neighborhood: neighborhoodName(place.neighborhood_id),
    logoUrl: logoUrl(place.logo_key),
    branches,
    similar,
    discounts,
    guides,
  }
}
