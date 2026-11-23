import { cacheLife, cacheTag } from 'next/cache'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { label } from '@shared/tags.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import { getSql } from '../db'
import { logoUrl } from '../search/logo'
import { activeNeighborhoods, findGuide, guideBreadcrumb, liveGuides, type GuideCrumb } from './catalog'
import { assembleGuidePlaces, GUIDE_PLACES_SQL, type GuidePlaceRow } from './places'
import { relatedGuides } from './entries'
import { guideCard, type GuideCardData } from './neighborhood'
import { allGuidesUncached, publishedGuides, publishedGuidesUncached } from './published'
import type { Guide, GuidePhoto } from './types'

export type GuidePagePlace = {
  id: string
  number: number
  slug: string
  name: string
  /** "Cordón · Café". */
  meta: string
  logoUrl: string | null
  logoBgColor: string | null
  iconCategory: IconCategory | null
  lat: number
  lng: number
  text: string
  photo: GuidePhoto | null
}

export type GuidePageData = {
  guide: Guide
  /** El barrio de la guía como etiqueta ("Pocitos"); null en una guía de toda la ciudad. */
  neighborhoodLabel: string | null
  /** Las migas con sus links: Montevideo / título, o con el barrio si su página está activa. */
  breadcrumb: GuideCrumb[]
  places: GuidePagePlace[]
  /** "Más guías": hasta 4 guías publicadas relacionadas, sin la actual (relatedGuides), como tarjetas. Vacío: no se muestra. */
  related: GuideCardData[]
}

/**
 * La página de una guía ya encontrada: sus lugares publicados, numerados, y las tarjetas de "Más guías". Los lugares de
 * la guía y de las relacionadas salen en una sola consulta (sólo datos propios). `guides`: la lista de donde salen los
 * barrios activos (migas) y las relacionadas (sólo publicadas con página).
 */
async function buildGuidePage(guide: Guide, guides: readonly Guide[]): Promise<GuidePageData> {
  const related = relatedGuides(guide, guides)
  const ids = [...new Set([guide, ...related].flatMap((entry) => entry.places.map((place) => place.id)))]
  const rows = ids.length > 0 ? ((await getSql().query(GUIDE_PLACES_SQL, [ids])) as GuidePlaceRow[]) : []
  const active = activeNeighborhoods(guides)
  return {
    related: related.flatMap((entry) => guideCard(entry, rows, logoUrl) ?? []),
    guide,
    neighborhoodLabel: guide.neighborhood ? (neighborhoodDisplayName(guide.neighborhood) ?? guide.neighborhood) : null,
    breadcrumb: guideBreadcrumb(guide, active),
    places: assembleGuidePlaces(guide.places, rows).map(({ number, text, photo, row }) => ({
      id: row.id,
      number,
      slug: row.slug,
      name: row.name,
      meta: [neighborhoodDisplayName(row.neighborhoodId), row.categories[0] ? label(row.categories[0], 'es') : null].filter(Boolean).join(' · '),
      logoUrl: logoUrl(row.logoKey),
      logoBgColor: row.logoBgColor,
      iconCategory: row.iconCategory,
      lat: row.lat,
      lng: row.lng,
      text,
      photo,
    })),
  }
}

/**
 * Todo lo de la página de una guía (/guides/montevideo/<slug>, de barrio o de toda la ciudad), igual para todos: la guía
 * publicada (de la base) y sus lugares publicados (sólo datos propios). Cacheado (`'use cache'`) por un minuto: la
 * página se prerenderiza en el build y se regenera sin deploy. null si la guía no existe o no tiene lugares
 * publicados.
 */
async function getCachedGuidePage(slug: string): Promise<GuidePageData | null> {
  'use cache'
  cacheTag('guides')
  cacheLife('guides')

  const published = await publishedGuides()
  const guide = findGuide(slug, liveGuides(published))
  return guide ? buildGuidePage(guide, published) : null
}

/**
 * Si la caché todavía no conoce un slug recién publicado, se confirma una vez contra la base: así el primer pedido no
 * queda en 404 hasta la próxima revalidación. Para las rutas normales, sólo usa getCachedGuidePage.
 */
export async function getGuidePage(slug: string): Promise<GuidePageData | null> {
  const cached = await getCachedGuidePage(slug)
  if (cached) return cached
  const published = await publishedGuidesUncached()
  const guide = findGuide(slug, liveGuides(published))
  return guide ? buildGuidePage(guide, published) : null
}

/**
 * La vista previa (sólo con la clave, ver app/guide-preview): la guía en cualquier estado, también borrador o sin
 * lugares publicados, leída en el momento, sin cache. Las migas usan los barrios activos de lo publicado.
 */
export async function getGuidePreview(slug: string): Promise<GuidePageData | null> {
  const all = await allGuidesUncached()
  const guide = findGuide(slug, all)
  return guide ? buildGuidePage(guide, all) : null
}
