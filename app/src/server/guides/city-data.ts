import { cacheLife, cacheTag } from 'next/cache'
import { getSql } from '../db'
import { logoUrl } from '../search/logo'
import { cityPath, citySeo, GUIDE_CITY, liveGuides } from './catalog'
import { cityNeighborhoods, pickCityGroups, type CityNeighborhood } from './city'
import type { GuideGroupRow } from './neighborhood'
import { GUIDE_PLACES_SQL, type GuidePlaceRow } from './places'
import { guideIntros, publishedGuides } from './published'

export type CityPageData = {
  title: string
  path: string
  intro: string[]
  seoTitle: string
  seoDescription: string
  groups: GuideGroupRow[]
  neighborhoods: CityNeighborhood[]
}

/**
 * La página de guías de Montevideo, igual para todos: las guías publicadas (de barrio y de ciudad) elegidas por grupo,
 * los barrios con guías y la introducción de la ciudad. Una consulta con los lugares de todas las guías (sólo datos
 * propios). Cacheada como el resto: un minuto, tag 'guides'. Sin guías, la página sale con el título y sin filas.
 */
export async function getCityPage(): Promise<CityPageData> {
  'use cache'
  cacheTag('guides')
  cacheLife('guides')

  const [all, intros] = await Promise.all([publishedGuides(), guideIntros()])
  const guides = liveGuides(all).filter((guide) => guide.city === GUIDE_CITY.city)
  const ids = [...new Set(guides.flatMap((guide) => guide.places.map((place) => place.id)))]
  const rows = ids.length > 0 ? ((await getSql().query(GUIDE_PLACES_SQL, [ids])) as GuidePlaceRow[]) : []
  const intro = new Map(intros).get(null) ?? []
  return {
    title: GUIDE_CITY.title,
    path: cityPath(GUIDE_CITY.city),
    intro,
    ...citySeo(intro),
    groups: pickCityGroups(guides, rows, logoUrl),
    neighborhoods: cityNeighborhoods(guides),
  }
}
