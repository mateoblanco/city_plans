import polygons from '@shared/neighborhood-polygons.json'
import type { Bounds, LatLng, LocationChoice, UserLocation } from '@/lib/location'
import { SEARCH_CONFIG } from './config'
import type { Lang } from './interpretation'
import { DISPLAY_LANG, distanceText } from './labels'

export { parseLocationChoice, parseLocationCookie, type Bounds, type LocationChoice, type UserLocation } from '@/lib/location'

/**
 * Dónde busca la búsqueda (lo que muestra el filtro "Dónde"):
 * - near: cerca mío, desde `origin` (la cookie de la persona, nunca la URL), con el radio que se usó.
 * - all: todo Montevideo; reason dice por qué (elegido, permiso negado, ubicación fuera de Montevideo o por defecto).
 * - neighborhood: uno o más barrios (de la barra o del texto).
 * - zone: el área del mapa de "Buscar en esta zona".
 * - ask: sin elección ni ubicación conocida; la respuesta no trae resultados y el cliente pide el permiso. explicit: lo
 *   pidió la persona (eligió "Cerca mío" o lo escribió), así que se pide aunque antes lo haya negado.
 */
export type SearchLocation =
  | { kind: 'near'; origin: LatLng; radiusM: number }
  | { kind: 'all'; reason: 'chosen' | 'denied' | 'outside' | 'default' }
  | { kind: 'neighborhood' }
  | { kind: 'zone'; bounds: Bounds }
  | { kind: 'ask'; explicit: boolean }

export type LocationInput = {
  choice: LocationChoice | null
  user: UserLocation | null
  /** Sólo /search y /api/search: sin elección, cerca mío (o pedir la ubicación). La home y los scripts, todo Montevideo. */
  defaultNear: boolean
  /** Barrios de la interpretación final (barra o texto sin quitar). */
  neighborhoods: string[]
  /** Venues pedidos ("en el Mercado del Puerto"): ya dicen dónde. */
  venues: string[]
  /** Lugar fijado por nombre: se busca en toda la ciudad. */
  pinned: boolean
  /** El texto dice "cerca mío". */
  textNear: boolean
}

const RINGS = Object.values(polygons as Record<string, number[][]>)

/** Punto dentro del anillo (ray casting; el anillo es [lng, lat]). */
function inRing(point: LatLng, ring: number[][]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Metros del punto al segmento a–b (proyección local plana). */
function segmentMeters(point: LatLng, a: number[], b: number[]) {
  const k = Math.cos((point.lat * Math.PI) / 180)
  const toXY = ([lng, lat]: number[]) => [(lng - point.lng) * k, lat - point.lat]
  const [ax, ay] = toXY(a)
  const [bx, by] = toXY(b)
  const dx = bx - ax
  const dy = by - ay
  const t = dx === 0 && dy === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)))
  const x = ax + t * dx
  const y = ay + t * dy
  return Math.sqrt(x * x + y * y) * 111_195
}

/** Dentro de algún barrio de Montevideo, o a menos de near.outsideToleranceM del borde. */
export function inMontevideo(point: LatLng): boolean {
  if (RINGS.some((ring) => inRing(point, ring))) return true
  const tolerance = SEARCH_CONFIG.near.outsideToleranceM
  return RINGS.some((ring) => ring.some((vertex, index) => index > 0 && segmentMeters(point, ring[index - 1], vertex) <= tolerance))
}

/**
 * Prioridad: un barrio (de la barra o del texto, sin quitar) gana siempre; después la zona; después lo elegido en `loc`
 * (o "cerca mío" en el texto); sin nada, por defecto. "Buscar en esta zona" y "Cerca mío" elegido a mano quitan el barrio
 * del texto (`remove`), así que ganan; un texto nuevo que nombra un barrio no lo quita y gana el barrio.
 */
export function resolveLocation(input: LocationInput): SearchLocation {
  if (input.neighborhoods.length) return { kind: 'neighborhood' }
  const { choice, user } = input
  if (choice?.kind === 'zone') return { kind: 'zone', bounds: choice.bounds }
  const near = (explicit: boolean): SearchLocation => {
    if (user?.kind === 'coords') {
      const origin = { lat: user.lat, lng: user.lng }
      return inMontevideo(origin) ? { kind: 'near', origin, radiusM: SEARCH_CONFIG.near.radii[0] } : { kind: 'all', reason: 'outside' }
    }
    if (explicit) return { kind: 'ask', explicit: true }
    return user ? { kind: 'all', reason: 'denied' } : { kind: 'ask', explicit: false }
  }
  // "Todo Montevideo" elegido (también al quitar "Cerca mío") gana sobre el "cerca mío" del texto.
  if (choice?.kind === 'all') return { kind: 'all', reason: 'chosen' }
  if (choice?.kind === 'near' || input.textNear) return near(true)
  if (!input.defaultNear || input.pinned || input.venues.length) return { kind: 'all', reason: 'default' }
  return near(false)
}

/** "Había pocos a 1,5 km: ampliamos a 3 km." */
export function radiusNotice(from: number, to: number, lang: Lang = DISPLAY_LANG) {
  const [a, b] = [distanceText(from, lang), distanceText(to, lang)]
  return lang === 'es' ? `Había pocos a ${a}: ampliamos a ${b}.` : `Few places within ${a}: widened to ${b}.`
}

export const OUTSIDE_NOTICE = { es: 'Tu ubicación está fuera de Montevideo: mostramos todo Montevideo.', en: 'You are outside Montevideo: showing all of Montevideo.' }
export const EMPTY_ZONE_NOTICE = { es: 'No encontramos lugares en esta zona.', en: 'No places in this area.' }

/** Multiplicador por distancia con cerca mío: 1 − slope × km, con piso. */
export function distanceFactor(meters: number | null): number {
  if (meters === null) return 1
  const { slope, floor } = SEARCH_CONFIG.near.decay
  return Math.max(floor, 1 - slope * (meters / 1000))
}
