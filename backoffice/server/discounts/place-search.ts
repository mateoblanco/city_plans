import { neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'
import { fold, nameSimilarity, normalizeName } from '../../src/lib/discount-names.ts'
import { getBarrio } from '../../src/lib/getNeighborhood.ts'
import { brandFromGoogleName } from '../providers/brand-name.ts'
import type { FoundPlace } from '../providers/places-provider.ts'
import { FAR_NAME_MIN, metersBetween, NEAR_STRONG_METERS } from './match.ts'

// Elegir el resultado de Google para un local de un proveedor que no está en la base. Puro.

/** Lo que se sabe del local de la fuente. */
export type SearchTarget = {
  name: string
  neighborhoodId: string | null
  address: string | null
  coordinates: { lat: number; lng: number } | null
}

/** Nombre parecido para ser candidato en un dudoso. */
export const DOUBTFUL_NAME_MIN = 0.45
export const MAX_SEARCH_CANDIDATES = 3

export type SearchChoice =
  | { kind: 'clear'; place: FoundPlace }
  | { kind: 'doubtful'; candidates: FoundPlace[] }
  | { kind: 'not_found' }

/** "La Pasiva, Av. Brasil 2580, Montevideo"; sin dirección, el barrio; sin nada, sólo el nombre y Montevideo. */
export function searchQuery(target: SearchTarget): string {
  const where = target.address ?? (target.neighborhoodId ? neighborhoodDisplayName(target.neighborhoodId) ?? target.neighborhoodId : null)
  return [target.name, where, 'Montevideo'].filter(Boolean).join(', ')
}

const STREET_WORDS = new Set(['av', 'avda', 'avenida', 'calle', 'bulevar', 'bvar', 'bv', 'blvr', 'rambla', 'esq', 'esquina', 'local', 'loc', 'apto', 'casi', 'entre', 'y', 'de', 'del', 'la', 'el', 'los', 'las', 'gral', 'general', 'dr', 'ing', 'montevideo', 'uruguay'])

/** La calle y el número de la fuente aparecen en la dirección de Google ("Av. Brasil 2580" ↔ "Av. Brasil 2580, 11300 Montevideo"). */
export function sameAddress(source: string, google: string): boolean {
  const number = /\b(\d{2,5})\b/.exec(source)?.[1]
  if (!number) return false
  const target = fold(google)
  if (!new RegExp(`\\b${number}\\b`).test(target)) return false
  const words = fold(source).replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((word) => word.length >= 4 && !STREET_WORDS.has(word) && !/^\d+$/.test(word))
  return words.length > 0 && words.some((word) => target.includes(word))
}

type Scored = { place: FoundPlace; similarity: number; exact: boolean; meters: number | null; passes: boolean }

/**
 * Claro: el nombre (la marca de Google, sin sucursal) se parece ≥ 0,8 y, si hay datos de ubicación, está cerca: con
 * coordenadas a ≤ 300 m; con dirección, mismo barrio o misma calle y número; con barrio, mismo barrio. Si pasa uno solo
 * (o varios y uno solo tiene el nombre normalizado igual), ése. Si pasan varios, o ninguno pero hay nombres parecidos,
 * dudoso con hasta 3. Fuera de Montevideo no cuenta.
 */
export function chooseGoogleResult(target: SearchTarget, results: FoundPlace[]): SearchChoice {
  const unique = [...new Map(results.map((place) => [place.placeId, place])).values()]
  const wanted = normalizeName(target.name)
  const scored: Scored[] = unique.flatMap((place) => {
    const neighborhood = getBarrio(place.lat, place.lng)
    if (!neighborhood) return []
    const brand = brandFromGoogleName(place.name)
    const similarity = Math.max(nameSimilarity(brand, target.name), nameSimilarity(place.name, target.name))
    const meters = target.coordinates ? metersBetween(target.coordinates, place) : null
    let near = true
    if (target.coordinates) near = (meters as number) <= NEAR_STRONG_METERS
    else if (target.address) near = neighborhood === target.neighborhoodId || sameAddress(target.address, place.address)
    else if (target.neighborhoodId) near = neighborhood === target.neighborhoodId
    const exact = Boolean(wanted) && (normalizeName(brand) === wanted || normalizeName(place.name) === wanted)
    return [{ place, similarity, exact, meters, passes: similarity >= FAR_NAME_MIN && near }]
  })
  const passing = scored.filter((item) => item.passes)
  if (passing.length === 1) return { kind: 'clear', place: passing[0].place }
  const exact = passing.filter((item) => item.exact)
  if (passing.length > 1 && exact.length === 1) return { kind: 'clear', place: exact[0].place }
  const candidates = scored
    .filter((item) => item.passes || item.similarity >= DOUBTFUL_NAME_MIN)
    .sort((a, b) => Number(b.passes) - Number(a.passes) || b.similarity - a.similarity || (a.meters ?? 0) - (b.meters ?? 0))
    .slice(0, MAX_SEARCH_CANDIDATES)
    .map((item) => item.place)
  return candidates.length ? { kind: 'doubtful', candidates } : { kind: 'not_found' }
}
