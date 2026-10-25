import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import { isSectionId, type SectionId } from '@shared/sections.ts'
import { roundCoord } from './coords'
import { DIET_KEYS, type DietKey, type Interpretation } from './interpretation'

/**
 * Filtros de la barra (`f=open:today,diet:vegan,neighborhood:CORDON,neighborhood:POCITOS`). No son un sistema aparte: se aplican sobre
 * la interpretación y salen como los mismos chips que lo escrito. Las categorías van por la intención (intents.ts).
 */
export type SearchFilters = {
  /** "Abre hoy": abierto ahora o abre más tarde hoy. */
  opensToday: boolean
  diet: DietKey[]
  /** Reemplazan los barrios del texto. */
  neighborhoods: string[]
  /**
   * "Ver todos" de un grupo (`section:outdoor`): exige la regla del grupo de shared/sections.ts. Uno solo; discover
   * no tiene regla fija, así que no es un filtro.
   */
  section: Exclude<SectionId, 'discover'> | null
}

export type LatLng = { lat: number; lng: number }

export const emptyFilters = (): SearchFilters => ({ opensToday: false, diet: [], neighborhoods: [], section: null })

export const hasFilters = (filters: SearchFilters) =>
  filters.opensToday || filters.diet.length > 0 || filters.neighborhoods.length > 0 || filters.section !== null

/** Parsea `f`; descarta lo que no está en los catálogos. */
export function parseFilters(raw: string | null | undefined): SearchFilters {
  const filters = emptyFilters()
  for (const part of (raw ?? '').split(',')) {
    const index = part.indexOf(':')
    if (index <= 0) continue
    const kind = part.slice(0, index).trim()
    const id = part.slice(index + 1).trim()
    if (kind === 'open' && id === 'today') filters.opensToday = true
    else if (kind === 'diet' && (DIET_KEYS as readonly string[]).includes(id) && !filters.diet.includes(id as DietKey)) filters.diet.push(id as DietKey)
    else if (kind === 'neighborhood' && id in NEIGHBORHOOD_NAMES && !filters.neighborhoods.includes(id)) filters.neighborhoods.push(id)
    else if (kind === 'section' && isSectionId(id) && id !== 'discover') filters.section = id
  }
  return filters
}

export { roundCoord }

/** Parsea `near=lat,lng` y lo redondea (aunque el cliente ya lo haga). null si no es una coordenada válida. */
export function parseNear(raw: string | null | undefined): LatLng | null {
  const parts = (raw ?? '').split(',')
  if (parts.length !== 2 || parts.some((part) => part.trim() === '')) return null
  const [lat, lng] = parts.map(Number)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  return { lat: roundCoord(lat), lng: roundCoord(lng) }
}

/**
 * Suma los filtros a lo interpretado. La dieta se suma; "abre hoy" y los barrios reemplazan lo del texto:
 * si se contradicen, gana el filtro.
 */
export function applyFilters(value: Interpretation, filters: SearchFilters): Interpretation {
  const must = { ...value.must, diet: { ...value.must.diet } }
  for (const key of filters.diet) must.diet[key] = true
  // "esta noche" del texto ya es "Abre hoy" (a la noche): el filtro no lo pisa.
  if (filters.opensToday && must.openAt !== 'tonight') must.openAt = 'today'
  if (filters.neighborhoods.length) must.neighborhoods = [...filters.neighborhoods]
  return { ...value, must }
}

/** Claves `kind:id` de chip que vienen de los filtros, para saber cómo se apaga cada chip. */
export function filterChipKeys(filters: SearchFilters): Set<string> {
  return new Set([
    ...(filters.opensToday ? ['openAt:today'] : []),
    ...filters.diet.map((key) => `diet:${key}`),
    ...filters.neighborhoods.map((id) => `neighborhood:${id}`),
    ...(filters.section ? [`section:${filters.section}`] : []),
  ])
}
