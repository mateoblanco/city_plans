import { searchHref } from '@/components/pages/SearchPage/utils/search-href'
import { runSearch, type SearchDeps } from '../search/search'
import type { Affinity } from './affinity'
import type { HomeRow } from './assemble'
import { HOME_CONFIG, homeSearchUrl, homeViewAllUrl, type HomeSectionDef } from './config'
import { openNowResults } from './open'

/** "Abierto ahora": el filtro de la barra con el que buscan todas las filas (salvo Guardados). */
export const OPEN_NOW = 'open:now'

/**
 * Cada fila con los primeros HOME_CONFIG.candidates lugares abiertos en `now` (el pool; sin texto: sólo SQL, en paralelo).
 * Sin guardados: es igual para todos. href es su "Ver todos": la misma búsqueda en /search (con `text`, en el buscador).
 */
export async function homeSectionRows(deps: SearchDeps, sections: HomeSectionDef[], now: Date): Promise<HomeRow[]> {
  return Promise.all(
    sections.map(async (section) => {
      const url = homeSearchUrl(section.search)
      const response = await runSearch('', deps, { intent: url.intent, sub: url.sub, filters: url.f, loc: url.loc, now })
      const href = searchHref(homeViewAllUrl(section.search))
      return { id: section.id, title: section.title, places: openNowResults(response).slice(0, HOME_CONFIG.candidates), href }
    }),
  )
}

/**
 * "Para vos" de la home con los guardados de la cookie como señal de gustos: el perfil con más guardados, de 4 a 8 lugares,
 * sólo entre los abiertos ahora (como las demás filas). affinity: la de cada candidato con el perfil de su tipo, para
 * reordenar las demás filas sin otra consulta. null sin guardados.
 */
export async function homeForYouRow(deps: SearchDeps, likes: string[], now: Date = new Date()): Promise<{ row: HomeRow | null; affinity: Affinity | null } | null> {
  if (likes.length === 0) return null
  const response = await runSearch('', deps, { likes, home: true, filters: OPEN_NOW, now })
  const affinity = response.affinity ?? null
  if (!response.forYou) return { row: null, affinity }
  const byId = new Map(openNowResults(response).map((place) => [place.id, place]))
  const row = { id: 'for_you', title: response.forYou.title, places: response.forYou.placeIds.flatMap((id) => byId.get(id) ?? []), href: null }
  return { row, affinity }
}
