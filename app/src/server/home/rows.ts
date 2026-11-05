import { searchHref } from '@/components/pages/SearchPage/utils/search-href'
import { runSearch, type SearchDeps, type SearchResponse } from '../search/search'
import type { HomeRow } from './assemble'
import { HOME_CONFIG, HOME_SECTIONS, homeSearchUrl } from './config'

/** "Abre hoy" de las filas, el mismo filtro de la barra de /search. */
const OPEN_TODAY = 'open:today'

/**
 * Si nada abría hoy, la búsqueda soltó el horario (relajó openAt) y trae cerrados: la fila queda vacía y no sale.
 */
const openResults = (response: SearchResponse) => (response.relaxed.some((notice) => notice.what === 'openAt') ? [] : response.results)

/**
 * Cada fila del config con los primeros HOME_CONFIG.candidates resultados de su búsqueda (sin texto: sólo SQL, en
 * paralelo). Sin likes: es igual para todos. href es su "Ver todos": los mismos parámetros que la búsqueda.
 */
export async function homeSectionRows(deps: SearchDeps, now?: Date): Promise<HomeRow[]> {
  return Promise.all(
    HOME_SECTIONS.map(async (section) => {
      const url = homeSearchUrl(section.search)
      const response = await runSearch(url.q, deps, { intent: url.intent, sub: url.sub, filters: url.f, now })
      return { id: section.id, title: section.title, places: openResults(response).slice(0, HOME_CONFIG.candidates), href: searchHref(url) }
    }),
  )
}

/**
 * "Para vos" de la home con los likes de la cookie: el perfil con más likes, de 4 a 8 lugares, sólo entre los que abren
 * hoy (como las demás filas). null sin perfil.
 */
export async function homeForYouRow(deps: SearchDeps, likes: string[], now?: Date): Promise<HomeRow | null> {
  if (likes.length === 0) return null
  const response = await runSearch('', deps, { likes, home: true, filters: OPEN_TODAY, now })
  if (!response.forYou) return null
  const byId = new Map(openResults(response).map((place) => [place.id, place]))
  return { id: 'for_you', title: response.forYou.title, places: response.forYou.placeIds.flatMap((id) => byId.get(id) ?? []), href: null }
}
