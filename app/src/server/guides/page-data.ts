import { cacheLife, cacheTag } from 'next/cache'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { label } from '@shared/tags.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import type { WeekStatus } from '@/lib/week-status'
import { getSql } from '../db'
import { logoUrl } from '../search/logo'
import { findCityGuide, findGuide, guideBreadcrumb, type GuideCrumb } from './catalog'
import { groupLabel } from './groups'
import { assembleGuidePlaces, GUIDE_PLACES_SQL, type GuidePlaceRow } from './places'
import { weekStatus } from './status'
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
  status: WeekStatus
}

export type GuidePageData = {
  guide: Guide
  /** "Cafés". */
  groupLabel: string
  /** Las migas con sus links: Guías de Montevideo / Cordón / título (sin barrio en una guía de ciudad). */
  breadcrumb: GuideCrumb[]
  places: GuidePagePlace[]
}

/**
 * Todo lo de la página de una guía, igual para todos: el archivo de la guía y los lugares publicados (sólo datos
 * propios). Cacheado (`'use cache'`): la página se prerenderiza en el build y se regenera al vencer (horas), así un lugar
 * despublicado sale de la guía sin un deploy. El estado de horario va como la semana entera (weekStatus) y lo elige el
 * navegador: el HTML cacheado nunca dice "Abierto" de más. null si la guía no existe. `barrio` null: una guía de toda la ciudad.
 */
export async function getGuidePage(barrio: string | null, slug: string): Promise<GuidePageData | null> {
  'use cache'
  cacheTag('guides')
  cacheLife('hours')

  // Sin barrio: una guía de toda la ciudad (/guides/montevideo/<slug>).
  const guide = barrio === null ? findCityGuide(slug) : findGuide(barrio, slug)
  if (!guide) return null
  const ids = guide.places.map((place) => place.id)
  const rows = (await getSql().query(GUIDE_PLACES_SQL, [ids])) as GuidePlaceRow[]

  return {
    guide,
    groupLabel: groupLabel(guide.group),
    breadcrumb: guideBreadcrumb(guide),
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
      status: weekStatus(row.hours),
    })),
  }
}
