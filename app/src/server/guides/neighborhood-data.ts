import { cacheLife, cacheTag } from 'next/cache'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { getSql } from '../db'
import { logoUrl } from '../search/logo'
import { isActiveNeighborhood, liveGuides, neighborhoodBreadcrumb, neighborhoodGuides, neighborhoodPath, neighborhoodSeo, type GuideCrumb } from './catalog'
import { groupGuides, type GuideGroupRow } from './neighborhood'
import { GUIDE_PLACES_SQL, type GuidePlaceRow } from './places'
import { guideIntros, introsUncached, publishedGuides, publishedGuidesUncached } from './published'

export type NeighborhoodPageData = {
  /** neighborhood_id ('CORDON'). */
  id: string
  /** "Cordón". */
  name: string
  path: string
  /** Montevideo / Cordón. */
  breadcrumb: GuideCrumb[]
  intro: string[]
  seoTitle: string
  seoDescription: string
  groups: GuideGroupRow[]
}

/**
 * La página de guías de un barrio, igual para todos: sus guías publicadas (de la base) con los logos y la cantidad de
 * sus lugares publicados (una consulta, sólo datos propios) y su introducción. Cacheada como la guía: un minuto, tag
 * 'guides'. null (404) si el barrio no llega a MIN_NEIGHBORHOOD_GUIDES guías con página (activeNeighborhoods): la página
 * queda lista y aparece sola cuando llega al mínimo.
 */
async function buildNeighborhoodPage(
  barrio: string,
  published: Awaited<ReturnType<typeof publishedGuides>>,
  intros: [string | null, string[]][],
): Promise<NeighborhoodPageData | null> {
  if (!isActiveNeighborhood(barrio, published)) return null
  const guides = neighborhoodGuides(barrio, liveGuides(published))
  const ids = [...new Set(guides.flatMap((guide) => guide.places.map((place) => place.id)))]
  const rows = (await getSql().query(GUIDE_PLACES_SQL, [ids])) as GuidePlaceRow[]
  const groups = groupGuides(guides, rows, logoUrl)
  if (groups.length === 0) return null

  // neighborhoodGuides sólo devuelve guías con barrio.
  const id = guides[0].neighborhood!
  const name = neighborhoodDisplayName(id) ?? id
  const intro = new Map(intros).get(id) ?? []
  return {
    id,
    name,
    path: neighborhoodPath(guides[0].city, id),
    breadcrumb: neighborhoodBreadcrumb(id),
    intro,
    ...neighborhoodSeo(name, intro),
    groups,
  }
}

async function getCachedNeighborhoodPage(barrio: string): Promise<NeighborhoodPageData | null> {
  'use cache'
  cacheTag('guides')
  cacheLife('guides')

  const [published, intros] = await Promise.all([publishedGuides(), guideIntros()])
  return buildNeighborhoodPage(barrio, published, intros)
}

/** Igual que la guía: un barrio que recién llega al mínimo se confirma en la base antes de dar 404. */
export async function getNeighborhoodPage(barrio: string): Promise<NeighborhoodPageData | null> {
  const cached = await getCachedNeighborhoodPage(barrio)
  if (cached) return cached
  const [published, intros] = await Promise.all([publishedGuidesUncached(), introsUncached()])
  return buildNeighborhoodPage(barrio, published, intros)
}
