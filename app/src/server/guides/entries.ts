import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { guidePath, liveGuides } from './catalog'
import type { Guide } from './types'

/**
 * Las entradas a las guías desde el resto de la app: la sección "Guías" de la home, "Aparece en estas guías" de la
 * ficha y "Más guías" al final de cada guía. Funciones puras sobre la lista de guías (publishedGuides): sólo las que
 * tienen página (liveGuides: publicadas con algún lugar publicado).
 */

export const HOME_GUIDES_MAX = 10
export const RELATED_GUIDES_MAX = 4

export type GuideLink = {
  slug: string
  title: string
  href: string
  /** El barrio como etiqueta ("Pocitos"); null en una guía de toda la ciudad. */
  neighborhood: string | null
  /** Lugares publicados (los que se ven en su página). */
  count: number
}

const linkOf = (guide: Guide): GuideLink => ({
  slug: guide.slug,
  title: guide.title,
  href: guidePath(guide),
  neighborhood: guide.neighborhood ? (neighborhoodDisplayName(guide.neighborhood) ?? guide.neighborhood) : null,
  count: guide.publishedPlaces,
})

/** Primero las destacadas (en el orden de la lista), después las demás de la más reciente a la más vieja (a igual fecha, el orden de la lista). */
function featuredThenRecent(guides: readonly Guide[]): Guide[] {
  const featured = guides.filter((guide) => guide.featured)
  const rest = guides
    .map((guide, index) => ({ guide, index }))
    .filter(({ guide }) => !guide.featured)
    .sort((a, b) => b.guide.updatedAt.localeCompare(a.guide.updatedAt) || a.index - b.index)
    .map(({ guide }) => guide)
  return [...featured, ...rest]
}

/** La sección "Guías" de la home: hasta HOME_GUIDES_MAX, primero las destacadas y después las más recientes. */
export function pickHomeGuides(guides: readonly Guide[], max = HOME_GUIDES_MAX): GuideLink[] {
  return featuredThenRecent(liveGuides(guides)).slice(0, max).map(linkOf)
}

/** "Aparece en estas guías" de la ficha: las guías con página que incluyen el lugar, en el mismo orden que la home. */
export function guidesWithPlace(guides: readonly Guide[], placeId: string): GuideLink[] {
  return featuredThenRecent(liveGuides(guides).filter((guide) => guide.places.some((place) => place.id === placeId))).map(linkOf)
}

/**
 * "Más guías" al final de una guía: sin la actual, primero las del mismo grupo, después las del mismo barrio (las dos
 * con barrio y el mismo), después las más recientes; a igual criterio, el orden de la lista. Hasta RELATED_GUIDES_MAX.
 */
export function relatedGuides(current: Guide, guides: readonly Guide[], max = RELATED_GUIDES_MAX): Guide[] {
  const sameNeighborhood = (guide: Guide) => current.neighborhood !== null && guide.neighborhood === current.neighborhood
  return liveGuides(guides)
    .map((guide, index) => ({ guide, index }))
    .filter(({ guide }) => guide.id !== current.id && guide.slug !== current.slug)
    .sort(
      (a, b) =>
        Number(b.guide.group === current.group) - Number(a.guide.group === current.group) ||
        Number(sameNeighborhood(b.guide)) - Number(sameNeighborhood(a.guide)) ||
        b.guide.updatedAt.localeCompare(a.guide.updatedAt) ||
        a.index - b.index,
    )
    .slice(0, max)
    .map(({ guide }) => guide)
}
