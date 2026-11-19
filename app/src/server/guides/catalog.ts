import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { MONTEVIDEO } from './montevideo/city'
import { CORDON_CAFES } from './montevideo/cordon/cafes-donde-nadie-te-apura'
import { CORDON_BEERS } from './montevideo/cordon/cervezas-artesanales'
import { CORDON } from './montevideo/cordon/neighborhood'
import { CORDON_SHARE } from './montevideo/cordon/para-compartir'
import { CORDON_SWEETS } from './montevideo/cordon/para-darse-un-gusto'
import { POCITOS_BRUNCH } from './montevideo/pocitos/brunch-en-pocitos'
import { MONTEVIDEO_SUSHI_DATE } from './montevideo/sushi-para-una-cita'
import type { Guide, GuideCity, GuideGroup, GuideNeighborhood } from './types'

/**
 * Todas las guías del repo, publicadas y borradores. Una guía nueva: su archivo en <ciudad>/<barrio>/<slug>.ts (o, si
 * es de toda la ciudad, <ciudad>/<slug>.ts) y la entrada acá. Para leerlas, visibleGuides (sin borradores en
 * producción), no esta lista.
 */
export const GUIDES: readonly Guide[] = [CORDON_CAFES, CORDON_SHARE, CORDON_BEERS, CORDON_SWEETS, MONTEVIDEO_SUSHI_DATE, POCITOS_BRUNCH]

/** La introducción y lo de Google de cada barrio con guías. */
export const GUIDE_NEIGHBORHOODS: readonly GuideNeighborhood[] = [CORDON]

/** La página de la ciudad. */
export const GUIDE_CITY: GuideCity = MONTEVIDEO

/** Los grupos de las páginas de barrio y ciudad, en el orden de las pestañas de la app: Comer, Tomar algo, Cafés, Postres. */
export const GUIDE_GROUPS: readonly GuideGroup[] = ['eat', 'bars', 'cafes', 'desserts']

type Env = { NODE_ENV?: string }

/** Los borradores sólo existen con `next dev`; en producción (y en el build), nunca. */
export const showDrafts = (env: Env = process.env) => env.NODE_ENV === 'development'

export const visibleGuides = (env: Env = process.env, guides: readonly Guide[] = GUIDES) =>
  guides.filter((guide) => !guide.draft || showDrafts(env))

/** El tramo de la URL de un barrio: su nombre sin tildes ni mayúsculas, con guiones ("Ciudad Vieja" → ciudad-vieja). */
export function neighborhoodSlug(id: string): string {
  return (neighborhoodDisplayName(id) ?? id)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Prefijos en inglés; barrio y slug, en español. */
export const cityPath = (city: string) => `/guides/${city}`

export const neighborhoodPath = (city: string, neighborhood: string) => `${cityPath(city)}/${neighborhoodSlug(neighborhood)}`

/** /guides/montevideo/<barrio>/<slug>; una guía de toda la ciudad, /guides/montevideo/<slug>. */
export const guidePath = (guide: Guide) =>
  guide.neighborhood ? `${neighborhoodPath(guide.city, guide.neighborhood)}/${guide.slug}` : `${cityPath(guide.city)}/${guide.slug}`

/** Una guía de barrio por el tramo del barrio y su slug. */
export function findGuide(barrio: string, slug: string, guides: readonly Guide[] = visibleGuides()): Guide | null {
  return guides.find((guide) => guide.slug === slug && !!guide.neighborhood && neighborhoodSlug(guide.neighborhood) === barrio) ?? null
}

/** Una guía de toda la ciudad por su slug. */
export function findCityGuide(slug: string, guides: readonly Guide[] = visibleGuides()): Guide | null {
  return guides.find((guide) => guide.slug === slug && !guide.neighborhood) ?? null
}

/** Las guías visibles de un barrio (por el tramo de la URL), en el orden de GUIDES; vacío si no tiene ninguna. */
export const neighborhoodGuides = (barrio: string, guides: readonly Guide[] = visibleGuides()) =>
  guides.filter((guide) => guide.city === 'montevideo' && !!guide.neighborhood && neighborhoodSlug(guide.neighborhood) === barrio)

/** El texto del barrio, si está en GUIDE_NEIGHBORHOODS. */
export const findNeighborhood = (id: string) => GUIDE_NEIGHBORHOODS.find((entry) => entry.neighborhood === id) ?? null

/**
 * Qué es /guides/montevideo/<segmento>: primero un barrio con guías visibles; si no, una guía de toda la ciudad; si no,
 * nada (404). Los slugs de las guías de ciudad nunca coinciden con un barrio (catalog.test.ts).
 */
export function resolveCitySegment(segment: string, guides: readonly Guide[] = visibleGuides()): { kind: 'neighborhood' } | { kind: 'guide'; guide: Guide } | null {
  if (neighborhoodGuides(segment, guides).length > 0) return { kind: 'neighborhood' }
  const guide = findCityGuide(segment, guides)
  return guide ? { kind: 'guide', guide } : null
}

/**
 * Slugs de guías de ciudad que coinciden con el de algún barrio (cualquiera de NEIGHBORHOOD_NAMES, tenga guías o no):
 * la ruta resolvería el barrio y la guía no se vería nunca. Tiene que ser vacío (catalog.test.ts).
 */
export const citySlugClashes = (guides: readonly Guide[] = GUIDES) => {
  const neighborhoods = new Set(Object.keys(NEIGHBORHOOD_NAMES).map(neighborhoodSlug))
  return guides.filter((guide) => !guide.neighborhood && neighborhoods.has(guide.slug)).map((guide) => guide.slug)
}

/** Los params de /guides/montevideo/[segment]/[slug]: las guías de barrio visibles. */
export const guideParams = (guides: readonly Guide[] = visibleGuides()) =>
  guides.flatMap((guide) => (guide.city === 'montevideo' && guide.neighborhood ? [{ segment: neighborhoodSlug(guide.neighborhood), slug: guide.slug }] : []))

/** Los params de /guides/montevideo/[segment] que son barrios: los que tienen alguna guía visible. */
export const neighborhoodParams = (guides: readonly Guide[] = visibleGuides()) =>
  [...new Set(guides.flatMap((guide) => (guide.city === 'montevideo' && guide.neighborhood ? [neighborhoodSlug(guide.neighborhood)] : [])))].map((segment) => ({ segment }))

/** Los params de /guides/montevideo/[segment] que son guías de toda la ciudad. */
export const cityGuideParams = (guides: readonly Guide[] = visibleGuides()) =>
  guides.flatMap((guide) => (guide.city === 'montevideo' && !guide.neighborhood ? [{ segment: guide.slug }] : []))

/** Un tramo de las migas: sin href, la página actual. */
export type GuideCrumb = { label: string; href?: string; current?: boolean }

/** Migas de un barrio: Guías de Montevideo / Cordón. */
export const neighborhoodBreadcrumb = (neighborhood: string): GuideCrumb[] => [
  { label: GUIDE_CITY.title, href: cityPath(GUIDE_CITY.city) },
  { label: neighborhoodDisplayName(neighborhood) ?? neighborhood, href: neighborhoodPath(GUIDE_CITY.city, neighborhood), current: true },
]

/** Migas de una guía: Guías de Montevideo / Cordón / título, o, de toda la ciudad, Guías de Montevideo / título. */
export const guideBreadcrumb = (guide: Guide): GuideCrumb[] => [
  { label: GUIDE_CITY.title, href: cityPath(guide.city) },
  ...(guide.neighborhood ? [{ label: neighborhoodDisplayName(guide.neighborhood) ?? guide.neighborhood, href: neighborhoodPath(guide.city, guide.neighborhood) }] : []),
  { label: guide.title, href: guidePath(guide), current: true },
]
