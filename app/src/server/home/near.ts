import { metersBetween, parseLocationCookie } from '@/lib/location'
import { searchHref } from '@/components/pages/SearchPage/utils/search-href'
import { runSearch, type SearchDeps, type SearchResult } from '../search/search'
import type { HomeRow } from './assemble'
import { openNowResults } from './open'
import { OPEN_NOW } from './rows'

export const NEAR_ROW = { id: 'near', title: 'Abierto ahora cerca tuyo' } as const

/** "Ver todos": cerca mío con "Abierto ahora". */
export const NEAR_HREF = searchHref({ q: '', loc: 'near', f: OPEN_NOW })

/**
 * "Abierto ahora cerca tuyo" con la ubicación de la cookie `loc` (redondeada, la misma de /search): la búsqueda vacía de
 * cerca mío abierta ahora (sólo SQL; ni los que abren más tarde ni los sin horario). Devuelve los lugares con su distancia:
 * el orden lo arma orderNear (home/affinity.ts) con la afinidad, que llega con "Para vos". La card trae la distancia. null
 * sin coordenadas en la cookie (nunca se pide el permiso) o con la ubicación fuera de Montevideo. Sin caché: es de cada
 * persona. Pasa por assembleHome como las demás filas.
 */
export async function homeNearRow(deps: SearchDeps, userLocation: string | null, now: Date = new Date()): Promise<{ row: HomeRow; meters: { place: SearchResult; meters: number }[] } | null> {
  if (parseLocationCookie(userLocation)?.kind !== 'coords') return null
  const response = await runSearch('', deps, { loc: 'near', userLocation, filters: OPEN_NOW, now })
  const location = response.location
  if (location.kind !== 'near') return null
  const meters = openNowResults(response)
    .map((place) => ({ place, meters: metersBetween(location.origin, place) }))
    .sort((a, b) => a.meters - b.meters)
  return { row: { ...NEAR_ROW, places: meters.map((item) => item.place), href: NEAR_HREF }, meters }
}
