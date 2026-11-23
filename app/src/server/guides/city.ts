import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { activeNeighborhoods, GUIDE_GROUPS, neighborhoodPath } from './catalog'
import { groupLabel } from './groups'
import { guideCard, type GuideGroupRow } from './neighborhood'
import type { GuidePlaceRow } from './places'
import type { Guide } from './types'

/** Cuántas guías van por grupo en la página de la ciudad. */
export const CITY_GROUP_MAX = 6

type LogoUrl = (key: string | null) => string | null

/**
 * Las guías de un grupo para la página de la ciudad (de barrio y de ciudad, mezcladas): las destacadas (`featured`) en
 * el orden del archivo; si el grupo no tiene ninguna, las más recientes (`updatedAt`; a igual fecha, el orden del
 * archivo). Hasta CITY_GROUP_MAX.
 */
export function pickGroupGuides(guides: readonly Guide[]): Guide[] {
  const featured = guides.filter((guide) => guide.featured)
  const picked = featured.length > 0 ? featured : [...guides].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return picked.slice(0, CITY_GROUP_MAX)
}

/**
 * Las filas de la página de la ciudad, en el orden de la app (Comer, Tomar algo, Cafés, Postres). Las guías sin lugares
 * publicados no cuentan (ni para elegir); un grupo sin guías no se muestra.
 */
export function pickCityGroups(guides: readonly Guide[], rows: readonly GuidePlaceRow[], logoUrl: LogoUrl): GuideGroupRow[] {
  return GUIDE_GROUPS.flatMap((group) => {
    const withPlaces = guides.filter((guide) => guide.group === group && guideCard(guide, rows, logoUrl))
    const cards = pickGroupGuides(withPlaces).flatMap((guide) => guideCard(guide, rows, logoUrl) ?? [])
    return cards.length > 0 ? [{ group, title: groupLabel(group), guides: cards }] : []
  })
}

export type CityNeighborhood = { id: string; name: string; href: string }

const collator = new Intl.Collator('es', { sensitivity: 'base' })

/**
 * Los barrios de la sección "Barrios": sólo los que tienen página (MIN_NEIGHBORHOOD_GUIDES guías con página,
 * activeNeighborhoods), en orden alfabético por el nombre que se muestra. Vacío: la sección no se muestra.
 */
export function cityNeighborhoods(guides: readonly Guide[]): CityNeighborhood[] {
  return [...activeNeighborhoods(guides)]
    .map((id) => ({ id, name: neighborhoodDisplayName(id) ?? id, href: neighborhoodPath('montevideo', id) }))
    .sort((a, b) => collator.compare(a.name, b.name))
}
