import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import { isSectionId, type SectionId } from '@shared/sections.ts'
import { isOccasionTag, TAG_IDS, type TagId } from '@shared/tags.ts'
import { parseChoice, type DiscountChoice } from '../discounts/selection'
import { roundCoord } from './coords'
import { DIET_KEYS, PRICES, type DietKey, type Interpretation, type Price } from './interpretation'

/**
 * Filtros de la barra (`f=open:today,diet:vegan,neighborhood:CORDON,neighborhood:POCITOS,price:low`). No son un sistema aparte: se aplican sobre
 * la interpretación y salen como los mismos chips que lo escrito. Las categorías van por la intención (intents.ts).
 */
export type SearchFilters = {
  /** "Abre hoy": abierto ahora o abre más tarde hoy. */
  opensToday: boolean
  diet: DietKey[]
  /** Reemplazan los barrios del texto. */
  neighborhoods: string[]
  /** Reemplazan los precios del texto. */
  price: Price[]
  /**
   * "Ver todos" de un grupo (`section:outdoor`): exige la regla del grupo de shared/sections.ts. Uno solo; discover
   * no tiene regla fija, así que no es un filtro.
   */
  section: Exclude<SectionId, 'discover'> | null
  /**
   * Tags exigidos sin texto (`tag:afternoon_snack`, las filas de la home y su "Ver todos"): se suman a los del texto.
   * Los momentos no: son siempre preferencia.
   */
  tags: TagId[]
  /**
   * Descuentos (`discount:itau.credit`): lugares con un beneficio de cualquiera de estos proveedor y tipo de tarjeta. No
   * es parte de la interpretación ni un chip: es sólo filtro y nunca se relaja.
   */
  discounts: DiscountChoice[]
}

export type LatLng = { lat: number; lng: number }

export const emptyFilters = (): SearchFilters => ({ opensToday: false, diet: [], neighborhoods: [], price: [], section: null, tags: [], discounts: [] })

export const hasFilters = (filters: SearchFilters) =>
  filters.opensToday || filters.diet.length > 0 || filters.neighborhoods.length > 0 || filters.price.length > 0 || filters.section !== null || filters.tags.length > 0 || filters.discounts.length > 0

const FILTER_TAGS = new Set<string>(TAG_IDS.filter((id) => !isOccasionTag(id)))

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
    else if (kind === 'price' && (PRICES as readonly string[]).includes(id) && !filters.price.includes(id as Price)) filters.price.push(id as Price)
    else if (kind === 'section' && isSectionId(id) && id !== 'discover') filters.section = id
    else if (kind === 'tag' && FILTER_TAGS.has(id) && !filters.tags.includes(id as TagId)) filters.tags.push(id as TagId)
    else if (kind === 'discount') {
      const choice = parseChoice(id)
      if (choice && !filters.discounts.some((item) => item.provider === choice.provider && item.card === choice.card)) filters.discounts.push(choice)
    }
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
 * Suma los filtros a lo interpretado. La dieta y los tags se suman; "abre hoy", los barrios y el precio reemplazan lo del texto:
 * si se contradicen, gana el filtro.
 */
export function applyFilters(value: Interpretation, filters: SearchFilters): Interpretation {
  const must = { ...value.must, diet: { ...value.must.diet } }
  for (const key of filters.diet) must.diet[key] = true
  // "esta noche" del texto ya es "Abre hoy" (a la noche): el filtro no lo pisa.
  if (filters.opensToday && must.openAt !== 'tonight') must.openAt = 'today'
  if (filters.neighborhoods.length) must.neighborhoods = [...filters.neighborhoods]
  if (filters.price.length) must.price = [...filters.price]
  if (filters.tags.length) must.tags = [...new Set([...must.tags, ...filters.tags])]
  return { ...value, must }
}

/** Claves `kind:id` de chip que vienen de los filtros, para saber cómo se apaga cada chip. */
export function filterChipKeys(filters: SearchFilters): Set<string> {
  return new Set([
    ...(filters.opensToday ? ['openAt:today'] : []),
    ...filters.diet.map((key) => `diet:${key}`),
    ...filters.neighborhoods.map((id) => `neighborhood:${id}`),
    ...filters.price.map((id) => `price:${id}`),
    ...(filters.section ? [`section:${filters.section}`] : []),
    ...filters.tags.map((id) => `tag:${id}`),
  ])
}
