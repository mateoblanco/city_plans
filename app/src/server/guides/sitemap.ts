import type { SitemapGuide } from '../seo/indexing'
import { cityPath, guidePath, neighborhoodPath, visibleGuides } from './catalog'
import type { Guide } from './types'

const newest = (guides: readonly Guide[]) => guides.map((guide) => guide.updatedAt).sort().at(-1)!

/**
 * Las páginas de guías para el sitemap: la de la ciudad (con la fecha de su guía más nueva), cada barrio (ídem) seguido
 * de sus guías y, al final, las guías de toda la ciudad. Sin borradores (visibleGuides: en el build no existen). /guides
 * no va: redirige a la ciudad.
 */
export function guideSitemapPages(guides: readonly Guide[] = visibleGuides()): SitemapGuide[] {
  if (guides.length === 0) return []
  const byNeighborhood = new Map<string, Guide[]>()
  const cityWide: Guide[] = []
  for (const guide of guides) {
    if (!guide.neighborhood) {
      cityWide.push(guide)
      continue
    }
    const path = neighborhoodPath(guide.city, guide.neighborhood)
    byNeighborhood.set(path, [...(byNeighborhood.get(path) ?? []), guide])
  }
  return [
    { path: cityPath('montevideo'), updatedAt: newest(guides) },
    ...[...byNeighborhood.entries()].flatMap(([path, list]) => [
      { path, updatedAt: newest(list) },
      ...list.map((guide) => ({ path: guidePath(guide), updatedAt: guide.updatedAt })),
    ]),
    ...cityWide.map((guide) => ({ path: guidePath(guide), updatedAt: guide.updatedAt })),
  ]
}
