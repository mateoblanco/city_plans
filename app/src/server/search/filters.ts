import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import { roundCoord } from './coords'
import { DIET_KEYS, type DietKey, type Interpretation } from './interpretation'

/**
 * Filtros de la barra (`f=open:now,diet:vegan,neighborhood:CORDON`). No son un sistema aparte: se aplican sobre
 * la interpretación y salen como los mismos chips que lo escrito. Las categorías van por la intención (intents.ts).
 */
export type SearchFilters = {
  openNow: boolean
  diet: DietKey[]
  /** Uno solo: reemplaza los barrios del texto. */
  neighborhood: string | null
}

export type LatLng = { lat: number; lng: number }

export const emptyFilters = (): SearchFilters => ({ openNow: false, diet: [], neighborhood: null })

export const hasFilters = (filters: SearchFilters) =>
  filters.openNow || filters.diet.length > 0 || filters.neighborhood !== null

/** Parsea `f`; descarta lo que no está en los catálogos. */
export function parseFilters(raw: string | null | undefined): SearchFilters {
  const filters = emptyFilters()
  for (const part of (raw ?? '').split(',')) {
    const index = part.indexOf(':')
    if (index <= 0) continue
    const kind = part.slice(0, index).trim()
    const id = part.slice(index + 1).trim()
    if (kind === 'open' && id === 'now') filters.openNow = true
    else if (kind === 'diet' && (DIET_KEYS as readonly string[]).includes(id) && !filters.diet.includes(id as DietKey)) filters.diet.push(id as DietKey)
    else if (kind === 'neighborhood' && id in NEIGHBORHOOD_NAMES) filters.neighborhood = id
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
 * Suma los filtros a lo interpretado. La dieta se suma; "abierto ahora" y el barrio reemplazan lo del texto:
 * si se contradicen, gana el filtro.
 */
export function applyFilters(value: Interpretation, filters: SearchFilters): Interpretation {
  const must = { ...value.must, diet: { ...value.must.diet } }
  for (const key of filters.diet) must.diet[key] = true
  if (filters.openNow) must.openAt = 'now'
  if (filters.neighborhood) must.neighborhoods = [filters.neighborhood]
  return { ...value, must }
}

/** Claves `kind:id` de chip que vienen de los filtros, para saber cómo se apaga cada chip. */
export function filterChipKeys(filters: SearchFilters): Set<string> {
  return new Set([
    ...(filters.openNow ? ['openAt:now'] : []),
    ...filters.diet.map((key) => `diet:${key}`),
    ...(filters.neighborhood ? [`neighborhood:${filters.neighborhood}`] : []),
  ])
}
