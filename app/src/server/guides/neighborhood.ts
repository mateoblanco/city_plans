import { assembleGuidePlaces, type GuidePlaceRow } from './places'
import { GUIDE_GROUPS, guidePath } from './catalog'
import { groupLabel } from './groups'
import type { Guide, GuideGroup, GuidePhoto } from './types'

/** Un logo de la tarjeta de una guía (decorativo). */
export type GuideCardLogo = { id: string; name: string; logoUrl: string | null; logoBgColor: string | null }

export type GuideCardData = {
  slug: string
  href: string
  title: string
  /** Lugares publicados de la guía (los que se ven en su página). */
  count: number
  /** Los primeros 3 lugares publicados de la guía, en su orden. */
  logos: GuideCardLogo[]
  cover: GuidePhoto | null
}

export type GuideGroupRow = { group: GuideGroup; title: string; guides: GuideCardData[] }

/** Cuántos logos lleva cada tarjeta. */
export const CARD_LOGOS = 3

type LogoUrl = (key: string | null) => string | null

/** La tarjeta de una guía con sus lugares publicados; null si no tiene ninguno (su página quedaría vacía). */
export function guideCard(guide: Guide, rows: readonly GuidePlaceRow[], logoUrl: LogoUrl): GuideCardData | null {
  const places = assembleGuidePlaces(guide.places, rows)
  if (places.length === 0) return null
  return {
    slug: guide.slug,
    href: guidePath(guide),
    title: guide.title,
    count: places.length,
    logos: places.slice(0, CARD_LOGOS).map(({ row }) => ({ id: row.id, name: row.name, logoUrl: logoUrl(row.logoKey), logoBgColor: row.logoBgColor })),
    cover: guide.cover ?? null,
  }
}

/**
 * Las filas de la página del barrio: los grupos en el orden de la app (GUIDE_GROUPS), cada uno con sus guías en el
 * orden del archivo. Una guía sin lugares publicados no sale (su página quedaría vacía); un grupo sin guías, tampoco.
 */
export function groupGuides(guides: readonly Guide[], rows: readonly GuidePlaceRow[], logoUrl: LogoUrl): GuideGroupRow[] {
  return GUIDE_GROUPS.flatMap((group) => {
    const cards = guides.filter((guide) => guide.group === group).flatMap((guide) => guideCard(guide, rows, logoUrl) ?? [])
    return cards.length > 0 ? [{ group, title: groupLabel(group), guides: cards }] : []
  })
}

/** "9 lugares", "1 lugar". */
export const placesCount = (count: number) => `${count} ${count === 1 ? 'lugar' : 'lugares'}`
