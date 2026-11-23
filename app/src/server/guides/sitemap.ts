import type { SitemapGuide } from '../seo/indexing'
import { activeNeighborhoods, cityPath, guidePath, liveGuides, neighborhoodPath } from './catalog'
import type { Guide } from './types'

const newest = (guides: readonly Guide[]) => guides.map((guide) => guide.updatedAt).sort().at(-1)!

/**
 * Las páginas de guías para el sitemap: la de la ciudad (con la fecha de su guía más nueva), cada barrio con página (con
 * el mínimo de guías; con la fecha de su guía más nueva) y todas las guías con página, en /guides/montevideo/<slug>.
 * Un barrio debajo del mínimo no va. /guides no va: redirige a la ciudad.
 */
export function guideSitemapPages(all: readonly Guide[]): SitemapGuide[] {
  const guides = liveGuides(all)
  if (guides.length === 0) return []
  const active = activeNeighborhoods(all)
  return [
    { path: cityPath('montevideo'), updatedAt: newest(guides) },
    ...[...active].map((id) => ({ path: neighborhoodPath('montevideo', id), updatedAt: newest(guides.filter((guide) => guide.neighborhood === id)) })),
    ...guides.map((guide) => ({ path: guidePath(guide), updatedAt: guide.updatedAt })),
  ]
}
