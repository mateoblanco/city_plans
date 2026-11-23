import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { GUIDE_GROUPS as SHARED_GROUPS, guideCityPath, guideNeighborhoodPath, guideUrlPath, MIN_NEIGHBORHOOD_GUIDES, neighborhoodSlug, seoDescriptionFromIntro } from '@shared/guides.ts'
import type { Guide, GuideGroup } from './types'
import { withSiteName } from '@/lib/site'

/**
 * Funciones puras sobre las guías (que vienen de la base, db.ts): rutas, búsquedas en una lista, params y migas. Sin
 * base ni cache: las usan las páginas, el sitemap y el proxy.
 */

export { neighborhoodSlug }

/** Los grupos de las páginas de barrio y ciudad, en el orden de las pestañas de la app: Comer, Tomar algo, Cafés, Postres. */
export const GUIDE_GROUPS: readonly GuideGroup[] = SHARED_GROUPS

/** La página de la ciudad: el h1, el primer tramo de las migas y lo de Google sin introducción (plantilla). */
export const GUIDE_CITY = {
  city: 'montevideo',
  title: 'Montevideo',
  seoTitle: withSiteName('Guías de Montevideo: dónde comer, tomar algo y cafés'),
  seoDescription: 'Guías elegidas a mano para salir en Montevideo: dónde comer, bares, cafés y postres, por barrio y en toda la ciudad.',
} as const

/** Lo de Google de un barrio: el título es siempre la plantilla; la descripción, el comienzo de su intro o la plantilla. */
export function neighborhoodSeo(name: string, intro: readonly string[]) {
  return {
    seoTitle: withSiteName(`Guías de ${name}, Montevideo`),
    seoDescription: seoDescriptionFromIntro(intro.join('\n\n')) ?? `Cafés, bares y dónde comer en ${name}, Montevideo: listas elegidas a mano, con horarios y mapa.`,
  }
}

/** Lo de Google de la ciudad: la descripción es el comienzo de su intro o la plantilla. */
export const citySeo = (intro: readonly string[]) => ({
  seoTitle: GUIDE_CITY.seoTitle,
  seoDescription: seoDescriptionFromIntro(intro.join('\n\n')) ?? GUIDE_CITY.seoDescription,
})

/** Prefijos en inglés; barrio y slug, en español. */
export const cityPath = (city: string) => guideCityPath(city)

export const neighborhoodPath = (city: string, neighborhood: string) => guideNeighborhoodPath(city, neighborhood)

/** Todas las guías, de barrio o de toda la ciudad: /guides/montevideo/<slug>. El barrio no va en la URL. */
export const guidePath = (guide: Pick<Guide, 'city' | 'slug'>) => guideUrlPath({ city: guide.city, slug: guide.slug })

/** Las que tienen página: publicadas (no borradores) con algún lugar publicado. */
export const liveGuides = (guides: readonly Guide[]) => guides.filter((guide) => !guide.draft && guide.live)

/** Una guía por su slug (único en la ciudad), de barrio o de toda la ciudad. */
export function findGuide(slug: string, guides: readonly Guide[]): Guide | null {
  return guides.find((guide) => guide.slug === slug) ?? null
}

/** Las guías de un barrio (por el tramo de la URL), en el orden de la lista; vacío si no tiene ninguna. */
export const neighborhoodGuides = (barrio: string, guides: readonly Guide[]) =>
  guides.filter((guide) => guide.city === 'montevideo' && !!guide.neighborhood && neighborhoodSlug(guide.neighborhood) === barrio)

/**
 * Los barrios con página (neighborhood_id): los que tienen al menos MIN_NEIGHBORHOOD_GUIDES guías con página. Los demás
 * no tienen página (404), ni van al sitemap, ni a "Barrios", ni a las migas de sus guías.
 */
export function activeNeighborhoods(guides: readonly Guide[], min = MIN_NEIGHBORHOOD_GUIDES): Set<string> {
  const counts = new Map<string, number>()
  for (const guide of liveGuides(guides)) if (guide.neighborhood) counts.set(guide.neighborhood, (counts.get(guide.neighborhood) ?? 0) + 1)
  return new Set([...counts].filter(([, count]) => count >= min).map(([id]) => id))
}

/** Si el tramo de la URL es un barrio con página. */
export const isActiveNeighborhood = (barrio: string, guides: readonly Guide[]) => [...activeNeighborhoods(guides)].some((id) => neighborhoodSlug(id) === barrio)

/**
 * Qué es /guides/montevideo/<segmento>: un barrio con página (con el mínimo de guías); si no, una guía con página (de
 * barrio o de ciudad); si no, nada (404). El backoffice no deja que un slug de guía sea el de un barrio, así que no
 * pueden chocar.
 */
export function resolveCitySegment(segment: string, guides: readonly Guide[]): { kind: 'neighborhood' } | { kind: 'guide'; guide: Guide } | null {
  if (isActiveNeighborhood(segment, guides)) return { kind: 'neighborhood' }
  const guide = findGuide(segment, liveGuides(guides))
  return guide ? { kind: 'guide', guide } : null
}

/**
 * Con cacheComponents, generateStaticParams no puede devolver una lista vacía (error de build), y la base puede no tener
 * guías. Este segmento no existe nunca: la página da notFound() y el proxy, 404.
 */
export const EMPTY_PARAM = '__none__'

/** Los params de /guides/montevideo/[segment]: los barrios con página y todas las guías con página. */
export const segmentParams = (guides: readonly Guide[]) => {
  const neighborhoods = [...activeNeighborhoods(guides)].map(neighborhoodSlug)
  const slugs = liveGuides(guides).map((guide) => guide.slug)
  const params = [...neighborhoods, ...slugs].map((segment) => ({ segment }))
  return params.length > 0 ? params : [{ segment: EMPTY_PARAM }]
}

/** Un tramo de las migas: sin href, la página actual. */
export type GuideCrumb = { label: string; href?: string; current?: boolean }

/** Migas de un barrio: Montevideo / Cordón. */
export const neighborhoodBreadcrumb = (neighborhood: string): GuideCrumb[] => [
  { label: GUIDE_CITY.title, href: cityPath(GUIDE_CITY.city) },
  { label: neighborhoodDisplayName(neighborhood) ?? neighborhood, href: neighborhoodPath(GUIDE_CITY.city, neighborhood), current: true },
]

/**
 * Migas de una guía: Montevideo / título. Con barrio y su página activa (`active`, de activeNeighborhoods),
 * Montevideo / Cordón (link) / título. El BreadcrumbList del JSON-LD sale de acá.
 */
export const guideBreadcrumb = (guide: Guide, active: ReadonlySet<string>): GuideCrumb[] => [
  { label: GUIDE_CITY.title, href: cityPath(guide.city) },
  ...(guide.neighborhood && active.has(guide.neighborhood)
    ? [{ label: neighborhoodDisplayName(guide.neighborhood) ?? guide.neighborhood, href: neighborhoodPath(guide.city, guide.neighborhood) }]
    : []),
  { label: guide.title, href: guidePath(guide), current: true },
]
