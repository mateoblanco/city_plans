import 'server-only'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import type { SearchResult } from '../search'
import { logoUrl } from '../search/logo'
import { BRANCH_FIELD_MASK, fetchPlaceDetails, parseDetails, streetAddress, type PlaceGoogleInfo } from './google'
import { getBranches, getPublishedPlace, type PlaceRow } from './place'
import { similarPlaces } from './similar'
import { placeDiscounts, type PlaceDiscountProvider } from '../discounts'

/** Otra sucursal en la ficha: la dirección es de Google, del pedido; null si no vino. */
export type BranchCardData = { id: string; slug: string; neighborhood: string; address: string | null }

/**
 * Lo de la base llega resuelto; lo de Google y los parecidos, como promesas ya lanzadas (una llamada cada una), para
 * que la ficha dibuje lo de la base sin esperarlos y cada parte lenta vaya en su propio <Suspense>. Ninguna rechaza.
 */
export type PlacePageData = {
  place: PlaceRow
  neighborhood: string
  logoUrl: string | null
  /** null si Google falló o el lugar no tiene google_place_id: las partes de Google se ocultan. */
  google: Promise<PlaceGoogleInfo | null>
  /** Otras sucursales con la dirección de Google de cada una. */
  branches: Promise<BranchCardData[]>
  similar: Promise<SearchResult[]>
  /** Descuentos que cuentan, por proveedor (orden de la config); [] sin descuentos o si falla la consulta. */
  discounts: PlaceDiscountProvider[]
}

const neighborhoodName = (id: string) => neighborhoodDisplayName(id) ?? id

/** Dirección de una sucursal: sólo shortFormattedAddress (SKU Essentials). Si falla, la card va sin dirección. */
async function branchAddress(googlePlaceId: string | null): Promise<string | null> {
  const result = await fetchPlaceDetails(googlePlaceId, undefined, undefined, BRANCH_FIELD_MASK)
  if (!result.ok) return null
  const body = result.data as { shortFormattedAddress?: unknown } | null
  return streetAddress(body?.shortFormattedAddress)
}

/**
 * Todo lo de la ficha: la fila de la base y los descuentos (también de la base: van debajo del mapa y, si llegaran
 * después, moverían lo de abajo) y, lanzados en paralelo sin esperarlos, Place Details del lugar, la dirección de cada
 * sucursal y los parecidos. Lo de Google se pide en cada request y nunca se guarda. null si el lugar no existe o no
 * está publicado.
 */
export async function getPlacePage(slug: string): Promise<PlacePageData | null> {
  const place = await getPublishedPlace(slug)
  if (!place) return null

  // fetchPlaceDetails no tira; el catch es por las dudas (una promesa rechazada sin esperar tiraría el proceso).
  const google = fetchPlaceDetails(place.google_place_id)
    .then((details) => (details.ok ? parseDetails(details.data) : null))
    .catch((error) => {
      console.warn('parseDetails', error)
      return null
    })
  // Las direcciones de las sucursales salen apenas llegan sus filas, sin esperar a lo demás.
  const branches = getBranches(place.brand_key, place.id)
    .catch((error) => {
      console.warn('getBranches', error)
      return []
    })
    .then((rows) => Promise.all(rows.map(async (row) => ({ row, address: await branchAddress(row.googlePlaceId) }))))
    .then((rows) => rows.map(({ row, address }) => ({ id: row.id, slug: row.slug, neighborhood: neighborhoodName(row.neighborhoodId), address })))
  // similarPlaces no tira (si falla, []).
  const similar = similarPlaces(place)
  const discounts = await placeDiscounts(place.id).catch((error) => {
    console.warn('placeDiscounts', error)
    return []
  })

  return {
    place,
    neighborhood: neighborhoodName(place.neighborhood_id),
    logoUrl: logoUrl(place.logo_key),
    google,
    branches,
    similar,
    discounts,
  }
}
