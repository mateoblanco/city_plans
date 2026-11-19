import { cacheLife, cacheTag } from 'next/cache'
import { getSql } from '../db'
import { logoUrl } from '../search/logo'
import { cityPath, GUIDE_CITY, visibleGuides } from './catalog'
import { cityNeighborhoods, pickCityGroups, type CityNeighborhood } from './city'
import type { GuideGroupRow } from './neighborhood'
import { GUIDE_PLACES_SQL, type GuidePlaceRow } from './places'

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
 * La página de guías de Montevideo, igual para todos: las guías visibles (de barrio y de ciudad) elegidas por grupo y
 * los barrios con guías. Una consulta con los lugares de todas las guías (sólo datos propios). Cacheada como el resto:
 * horas, tag 'guides'.
 */
export async function getCityPage(): Promise<CityPageData> {
  'use cache'
  cacheTag('guides')
  cacheLife('hours')

  const guides = visibleGuides().filter((guide) => guide.city === GUIDE_CITY.city)
  const ids = [...new Set(guides.flatMap((guide) => guide.places.map((place) => place.id)))]
  const rows = ids.length > 0 ? ((await getSql().query(GUIDE_PLACES_SQL, [ids])) as GuidePlaceRow[]) : []
  return {
    title: GUIDE_CITY.title,
    path: cityPath(GUIDE_CITY.city),
    intro: GUIDE_CITY.intro,
    seoTitle: GUIDE_CITY.seoTitle,
    seoDescription: GUIDE_CITY.seoDescription,
    groups: pickCityGroups(guides, rows, logoUrl),
    neighborhoods: cityNeighborhoods(guides, rows),
  }
}
