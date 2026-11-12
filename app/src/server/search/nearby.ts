import polygons from '@shared/neighborhood-polygons.json'
import type { Collapsed } from './branches'
import type { NearbyFilter } from './candidates'
import { SEARCH_CONFIG } from './config'
import type { Lang } from './interpretation'
import { DISPLAY_LANG } from './labels'
import { neighborhoodNames } from './relax'

/**
 * "Cerca de <barrio>": con un barrio pedido, además de sus resultados, los de otros barrios a menos de
 * SEARCH_CONFIG.nearby.radiusM del borde, con los mismos filtros y la misma búsqueda. Es la única forma de salir del
 * barrio: el barrio nunca se relaja.
 */

const POLYGONS: Record<string, number[][]> = polygons
const geoJsonCache = new Map<string, string>()

/** El anillo del barrio como GeoJSON (va como parámetro a ST_GeomFromGeoJSON); null si el barrio no tiene polígono. */
function polygonGeoJson(id: string): string | null {
  const ring = POLYGONS[id]
  if (!ring) return null
  let geoJson = geoJsonCache.get(id)
  if (!geoJson) {
    geoJson = JSON.stringify({ type: 'Polygon', coordinates: [ring] })
    geoJsonCache.set(id, geoJson)
  }
  return geoJson
}

/** El filtro de los cercanos a los barrios pedidos; null sin barrio o sin ningún polígono. */
export function nearbyFilterFor(neighborhoods: string[]): NearbyFilter | null {
  const shapes = neighborhoods.flatMap((id) => polygonGeoJson(id) ?? [])
  if (!shapes.length) return null
  return { exclude: neighborhoods, polygons: shapes, radiusM: SEARCH_CONFIG.nearby.radiusM }
}

/** "Palermo", "Palermo y Cordón". */
export const nearbyLabel = (neighborhoods: string[], lang: Lang = DISPLAY_LANG) => neighborhoodNames(neighborhoods, lang)

/** "Cerca de Palermo". */
export const nearbyTitle = (neighborhoods: string[], lang: Lang = DISPLAY_LANG) => `${lang === 'es' ? 'Cerca de' : 'Near'} ${nearbyLabel(neighborhoods, lang)}`

/** Aviso cuando el barrio no tiene resultados y los cercanos sí. */
export const emptyNeighborhoodNotice = (neighborhoods: string[], lang: Lang = DISPLAY_LANG) => ({
  what: 'neighborhood' as const,
  message: lang === 'es' ? `No encontramos en ${nearbyLabel(neighborhoods, lang)}; estos están cerca.` : `Nothing in ${nearbyLabel(neighborhoods, lang)}; these are nearby.`,
})

/**
 * Los cercanos en el orden del grupo: primero los que coinciden de verdad ("has") y, dentro de cada nivel, por distancia al
 * borde del barrio (a igual distancia, el orden del ranking). Sin los lugares ni las marcas que ya salieron en el barrio.
 */
export function orderNearby(items: Collapsed[], shown: Collapsed[]): Collapsed[] {
  const ids = new Set(shown.flatMap((item) => [item.row.id, ...item.branches.map((branch) => branch.row.id)]))
  const brands = new Set(shown.flatMap((item) => (item.row.brandKey ? [item.row.brandKey] : [])))
  const level = (item: Collapsed) => (item.matchLevel === 'has' ? 0 : 1)
  return items
    .filter((item) => !ids.has(item.row.id) && !(item.row.brandKey && brands.has(item.row.brandKey)))
    .map((item, index) => ({ item, index }))
    .sort((a, b) => level(a.item) - level(b.item) || (a.item.row.edgeDistance ?? Infinity) - (b.item.row.edgeDistance ?? Infinity) || a.index - b.index)
    .map(({ item }) => item)
}
