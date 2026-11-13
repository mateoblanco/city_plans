import { metersBetween, parseLocationCookie } from '@/lib/location'
import { searchHref } from '@/components/pages/SearchPage/utils/search-href'
import { runSearch, type SearchDeps } from '../search/search'
import type { HomeRow } from './assemble'
import { openResults } from './rows'

export const NEAR_ROW = { id: 'near', title: 'Abierto ahora cerca tuyo' } as const

/** "Ver todos": cerca mío con "Abre hoy" (el filtro de la barra más parecido a "abierto ahora"). */
export const NEAR_HREF = searchHref({ q: '', loc: 'near', f: 'open:today' })

/**
 * "Abierto ahora cerca tuyo" con la ubicación de la cookie `loc` (redondeada, la misma de /search): la búsqueda vacía de
 * cerca mío con "Abre hoy" (sólo SQL), sólo los abiertos ahora (ni los que abren más tarde ni los sin horario), del más
 * cercano al más lejano. La card trae la distancia. null sin coordenadas en la cookie (nunca se pide el permiso) o con
 * la ubicación fuera de Montevideo. Sin caché: es de cada persona. Pasa por assembleHome como las demás filas.
 */
export async function homeNearRow(deps: SearchDeps, userLocation: string | null, now?: Date): Promise<HomeRow | null> {
  if (parseLocationCookie(userLocation)?.kind !== 'coords') return null
  const response = await runSearch('', deps, { loc: 'near', userLocation, filters: 'open:today', now })
  const location = response.location
  if (location.kind !== 'near') return null
  const places = openResults(response)
    .filter((place) => place.openStatus.state === 'open')
    .map((place) => ({ place, meters: metersBetween(location.origin, place) }))
    .sort((a, b) => a.meters - b.meters)
    .map((item) => item.place)
  return { ...NEAR_ROW, places, href: NEAR_HREF }
}
