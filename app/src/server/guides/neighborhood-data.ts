import { cacheLife, cacheTag } from 'next/cache'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { getSql } from '../db'
import { logoUrl } from '../search/logo'
import { findNeighborhood, neighborhoodBreadcrumb, neighborhoodGuides, neighborhoodPath, type GuideCrumb } from './catalog'
import { groupGuides, type GuideGroupRow } from './neighborhood'
import { GUIDE_PLACES_SQL, type GuidePlaceRow } from './places'

export type NeighborhoodPageData = {
  /** neighborhood_id ('CORDON'). */
  id: string
  /** "Cordón". */
  name: string
  path: string
  /** Guías de Montevideo / Cordón. */
  breadcrumb: GuideCrumb[]
  intro: string[]
  seoTitle: string
  seoDescription: string
  groups: GuideGroupRow[]
}

/** Lo de Google de un barrio sin texto propio en GUIDE_NEIGHBORHOODS. */
const fallbackSeo = (name: string) => ({
  seoTitle: `Guías de ${name}, Montevideo · Salimos`,
  seoDescription: `Cafés, bares y dónde comer en ${name}, Montevideo: listas elegidas a mano, con horarios y mapa.`,
})

/**
 * La página de guías de un barrio, igual para todos: las guías visibles de ese barrio (del archivo) con los logos y la
 * cantidad de sus lugares publicados (una consulta, sólo datos propios). Cacheada como la guía: horas, tag 'guides'.
 * null (404) si el barrio no tiene guías o ninguna tiene lugares publicados.
 */
export async function getNeighborhoodPage(barrio: string): Promise<NeighborhoodPageData | null> {
  'use cache'
  cacheTag('guides')
  cacheLife('hours')

  const guides = neighborhoodGuides(barrio)
  if (guides.length === 0) return null
  const ids = [...new Set(guides.flatMap((guide) => guide.places.map((place) => place.id)))]
  const rows = (await getSql().query(GUIDE_PLACES_SQL, [ids])) as GuidePlaceRow[]
  const groups = groupGuides(guides, rows, logoUrl)
  if (groups.length === 0) return null

  // neighborhoodGuides sólo devuelve guías con barrio.
  const id = guides[0].neighborhood!
  const name = neighborhoodDisplayName(id) ?? id
  const text = findNeighborhood(id)
  return {
    id,
    name,
    path: neighborhoodPath(guides[0].city, id),
    breadcrumb: neighborhoodBreadcrumb(id),
    intro: text?.intro ?? [],
    ...(text ? { seoTitle: text.seoTitle, seoDescription: text.seoDescription } : fallbackSeo(name)),
    groups,
  }
}
