import type { DiscountLink, DiscountMatch, MatchCandidate, NearbyPlace, ProviderPlaceLocation } from '../../src/types/discounts.ts'
import distance from '@turf/distance'
import { point } from '@turf/helpers'
import { getBarrio } from '../../src/lib/getNeighborhood.ts'
import { instagramKey } from '../places/brand-key.ts'
import { montevideoNeighborhood, nameSimilarity, nameVariants, normalizeName, sharedDistinctiveWords, tokensOf } from '../../src/lib/discount-names.ts'
import type { ReadPlace } from './reader.ts'

/** Lo que el cruce lee de `places` (sólo lectura). */
export type MatchablePlace = {
  id: string
  name: string
  neighborhoodId: string
  brandKey: string | null
  instagram: string | null
  /** places.location, para cruzar con las coordenadas de un local de la fuente. */
  location?: { lng: number; lat: number } | null
}

/** Cerca de un local de la fuente: hasta esta distancia, y además con nombre parecido, es el mismo lugar. */
export const NEAR_METERS = 150
/** Un lugar lejos de todos los locales sólo es candidato si es de la marca o tiene un nombre así de parecido. */
export const FAR_NAME_MIN = 0.8
/** Con una señal fuerte (nombre normalizado igual o mismo Instagram) alcanza con estar a esta distancia. */
export const NEAR_STRONG_METERS = 300
/** Nombre parecido para confirmar por cercanía (o una señal fuerte: mismo nombre o Instagram). */
export const NEAR_NAME_MIN = 0.6
/** Pegado al local (mismo edificio o el de al lado): alcanza con compartir una palabra distintiva del nombre. */
export const SAME_SPOT_METERS = 30

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return distance(point([a.lng, a.lat]), point([b.lng, b.lat]), { units: 'meters' })
}

export { nameSimilarity, normalizeName }

const metersLabel = (meters: number) => (meters < 1000 ? `a ${Math.round(meters)} m` : `a ${(meters / 1000).toFixed(1).replace('.', ',')} km`)


/** Barrios de Montevideo que nombra la fuente: los de cada local y los de la ciudad ("Pocitos, Montevideo"). */
export function sourceNeighborhoods(place: { locations: ProviderPlaceLocation[]; city: string | null }): Set<string> {
  const found = new Set<string>()
  for (const location of place.locations) {
    // Un "Pinar" o "Centro" de otro departamento no es un barrio de Montevideo.
    if (!isMontevideoLocation(location)) continue
    const id = locationNeighborhood(location)
    if (id) found.add(id)
  }
  for (const part of (place.city ?? '').split(/,| y /)) {
    const id = montevideoNeighborhood(part)
    if (id) found.add(id)
  }
  return found
}

const STRONG_NAME = 0.95
const DOUBTFUL_MIN = 0.45
const MAX_CANDIDATES = 8

type Scored = MatchCandidate & { strong: boolean }

function score(place: ReadPlace, row: MatchablePlace, neighborhoods: Set<string>): Scored {
  const reasons: string[] = []
  let total = 0
  let strong = false
  // Cada forma de los dos nombres (el entero y el cortado antes de " - " o " | "): gana la que más se parece.
  const pairs = nameVariants(place.sourceName).flatMap((source) => nameVariants(row.name).map((ours) => {
    // Sin las palabras genéricas, un nombre corto deja de distinguir ("La Otra Parrilla" y "La Otra" quedan en "otra"):
    // así sólo cuenta como fuerte si el nombre entero coincide.
    const sameFull = tokensOf(source).join(' ') === tokensOf(ours).join(' ')
    const normalized = normalizeName(ours)
    const tooShort = !normalized.includes(' ') && normalized.length <= 5
    const similarity = nameSimilarity(source, ours)
    return { similarity, sameFull, tooShort, strongName: sameFull || (similarity >= STRONG_NAME && !tooShort), cut: source !== place.sourceName || ours !== row.name }
  }))
  const best = pairs.reduce((a, b) => (Number(b.strongName) - Number(a.strongName) || b.similarity - a.similarity) > 0 ? b : a)
  const { similarity, sameFull, tooShort } = best
  if (sameFull || (similarity >= STRONG_NAME && !tooShort)) {
    reasons.push('mismo nombre')
    strong = true
  } else if (similarity >= STRONG_NAME) {
    reasons.push('mismo nombre sin las palabras genéricas (corto)')
  } else if (similarity > 0) {
    reasons.push(`nombre parecido (${Math.round(similarity * 100)}%)`)
  }
  if (best.cut && best.similarity > pairs[0].similarity) reasons.push('nombre sin «- …»')
  total += similarity * 0.6
  const handle = instagramKey(row.instagram)
  if (place.instagram && handle && handle === place.instagram) {
    reasons.push('mismo Instagram')
    total += 0.4
    strong = true
  }
  if (neighborhoods.size > 0) {
    if (neighborhoods.has(row.neighborhoodId)) {
      reasons.push('mismo barrio')
      total += 0.15
    } else {
      reasons.push('otro barrio')
      total -= 0.1
    }
  }
  return { placeId: row.id, name: row.name, neighborhoodId: row.neighborhoodId, brandKey: row.brandKey, score: Math.round(Math.max(0, Math.min(1, total)) * 100) / 100, reasons, strong }
}

const strip = ({ strong: _strong, ...candidate }: Scored): MatchCandidate => candidate

/** Lo que decide el cruce automático: el estado, los vínculos (auto) y los candidatos. */
export type AutoMatch = Pick<DiscountMatch, 'status' | 'links' | 'candidates'>

function link(candidate: Scored, extra: { wholeBrand?: boolean; locationIndex?: number | null; reason?: string } = {}): DiscountLink {
  return {
    placeId: candidate.placeId,
    name: candidate.name,
    neighborhoodId: candidate.neighborhoodId,
    origin: 'auto',
    wholeBrand: extra.wholeBrand ?? false,
    score: candidate.score,
    reasons: extra.reason ? [...candidate.reasons, extra.reason] : candidate.reasons,
    locationIndex: extra.locationIndex ?? null,
  }
}

/** Con coordenadas, si caen en un barrio de Montevideo; sin ellas, por el departamento que da la fuente. */
const isMontevideoLocation = (location: ProviderPlaceLocation) => location.coordinates
  ? getBarrio(location.coordinates.lat, location.coordinates.lng) !== null
  : location.department === null || location.department === 'Montevideo'

/** Barrio de un local: el de sus coordenadas o el que escribe la fuente. */
const locationNeighborhood = (location: ProviderPlaceLocation) =>
  location.coordinates ? getBarrio(location.coordinates.lat, location.coordinates.lng) : montevideoNeighborhood(location.area)

/**
 * Cruza un lugar de la fuente con los guardados. Con una señal fuerte (mismo nombre normalizado o mismo Instagram) se
 * arma el grupo de la marca (más los que comparten brand_key o Instagram):
 * - si la fuente no lista direcciones en Montevideo, se vinculan todas las sucursales (toda la marca), salvo que la
 *   ciudad de la fuente nombre un barrio ("Pocitos, Montevideo"): entonces las de ese barrio, y si no hay, dudoso;
 * - si lista direcciones, cada una se vincula con la sucursal de su barrio; si alguna no cruza, queda dudoso con los
 *   vínculos que sí cruzaron y el resto de la marca como candidatos.
 * Sin señal fuerte, nombres parecidos como candidatos o "no está". Fuera de Montevideo no se cruza.
 */
export function matchPlace(place: ReadPlace, rows: MatchablePlace[]): AutoMatch {
  if (!place.montevideo) return { status: 'not_matched', links: [], candidates: [] }
  const neighborhoods = sourceNeighborhoods(place)
  const scored = rows.map((row) => score(place, row, neighborhoods))
  const strong = scored.filter((candidate) => candidate.strong)
  const locations = place.locations.map((location, index) => ({ location, index })).filter(({ location }) => isMontevideoLocation(location))

  // Todas las sucursales de la marca, no sólo la del nombre.
  const handleOf = (candidate: Scored) => instagramKey(rows.find((row) => row.id === candidate.placeId)!.instagram)
  const keys = new Set(strong.flatMap((candidate) => candidate.brandKey ?? []))
  const handles = new Set(strong.flatMap((candidate) => handleOf(candidate) ?? []))
  const group = strong.length === 0 ? [] : scored
    .filter((candidate) => candidate.strong || (candidate.brandKey !== null && keys.has(candidate.brandKey)) || handles.has(handleOf(candidate) ?? '\0'))
    .map((candidate) => (candidate.strong ? candidate : { ...candidate, reasons: [...candidate.reasons, 'misma marca'] }))
    .sort((a, b) => b.score - a.score)
  const candidatesOf = (rest: Scored[], note: string) => rest.slice(0, MAX_CANDIDATES).map((candidate) => ({ ...strip(candidate), reasons: [...candidate.reasons, note] }))

  // Con coordenadas (Santander): cada local con el lugar nuestro a ≤ 150 m y con nombre parecido. La distancia sola no
  // alcanza: cerca con otro nombre queda como candidato.
  if (locations.some(({ location }) => location.coordinates)) return matchByCoordinates(place, rows, scored, group, locations)

  if (strong.length === 0) {
    const close = scored.filter((candidate) => candidate.score >= DOUBTFUL_MIN).sort((a, b) => b.score - a.score)
    if (close.length > 0) return { status: 'doubtful', links: [], candidates: close.slice(0, MAX_CANDIDATES).map(strip) }
    return { status: 'missing', links: [], candidates: [] }
  }

  if (locations.length === 0) {
    // Sin direcciones: si la ciudad nombra un barrio, las sucursales de ese barrio; si no, toda la marca.
    if (neighborhoods.size > 0) {
      const inNeighborhood = group.filter((candidate) => neighborhoods.has(candidate.neighborhoodId))
      if (inNeighborhood.length === 0) return { status: 'doubtful', links: [], candidates: candidatesOf(group, 'el barrio de la fuente no coincide') }
      return { status: 'found', links: inNeighborhood.map((candidate) => link(candidate)), candidates: [] }
    }
    const wholeBrand = group.length > 1
    return { status: 'found', links: group.map((candidate) => link(candidate, { wholeBrand, reason: wholeBrand ? 'toda la marca: la fuente no lista direcciones' : undefined })), candidates: [] }
  }

  // Con direcciones sin coordenadas (BBVA): cada una con la sucursal de su barrio.
  const links = new Map<string, DiscountLink>()
  let unmatched = 0
  // Locales sin barrio: no se puede saber cuál sucursal es (cualquiera de la marca es candidata).
  let undecided = 0
  for (const { location, index } of locations) {
    const neighborhood = locationNeighborhood(location)
    const branches = neighborhood ? group.filter((candidate) => candidate.neighborhoodId === neighborhood) : []
    if (branches.length === 0) {
      unmatched += 1
      if (!neighborhood) undecided += 1
    }
    for (const branch of branches) {
      if (!links.has(branch.placeId)) links.set(branch.placeId, link(branch, { locationIndex: index, reason: `dirección: ${location.address}` }))
    }
  }
  if (unmatched === 0) return { status: 'found', links: [...links.values()], candidates: [] }
  // Cadena en parte: los locales que no cruzaron no tienen ninguna sucursal nuestra en su barrio. Es "encontrado" (con
  // "faltan sucursales en la base"), no una decisión pendiente.
  const rest = group.filter((candidate) => !links.has(candidate.placeId))
  if (links.size > 0 && (undecided === 0 || rest.length === 0)) return { status: 'found', links: [...links.values()], candidates: [] }
  const note = `${unmatched} de ${locations.length} ${locations.length === 1 ? 'dirección no cruza' : 'direcciones no cruzan'} con una sucursal`
  return { status: 'doubtful', links: [...links.values()], candidates: candidatesOf(rest, note) }
}

/**
 * Cuántos locales de Montevideo de la fuente no tienen un lugar nuestro vinculado en un cruce automático encontrado
 * (cadena en parte: "faltan sucursales en la base"). 0 si no aplica (toda la marca, manual o no encontrado).
 */
export function missingBranches(place: { montevideo: boolean; locations: ProviderPlaceLocation[] }, match: { status: DiscountMatch['status']; origin: DiscountMatch['origin']; links: { locationIndex: number | null }[] }): number {
  if (!place.montevideo || match.status !== 'found' || match.origin !== 'auto') return 0
  const covered = new Set(match.links.flatMap((item) => (item.locationIndex === null ? [] : [item.locationIndex])))
  if (covered.size === 0) return 0
  return place.locations.filter((location, index) => isMontevideoLocation(location) && !covered.has(index)).length
}

function matchByCoordinates(
  place: ReadPlace,
  rows: MatchablePlace[],
  scored: Scored[],
  group: Scored[],
  locations: { location: ProviderPlaceLocation; index: number }[],
): AutoMatch {
  // La mejor entre las formas de los dos nombres (el entero y el cortado antes de " - " o " | ").
  const bestSimilarity = (row: MatchablePlace) => Math.max(...nameVariants(place.sourceName).flatMap((source) => nameVariants(row.name).map((ours) => nameSimilarity(source, ours))))
  const similarity = new Map(rows.map((row) => [row.id, bestSimilarity(row)]))
  const byId = new Map(scored.map((candidate) => [candidate.placeId, candidate]))
  const links = new Map<string, DiscountLink>()
  const candidates = new Map<string, MatchCandidate>()
  let unmatched = 0
  // Locales sin coordenadas ni barrio que no cruzaron: no se sabe qué sucursal es, piden una decisión.
  let undecided = 0
  for (const { location, index } of locations) {
    const coordinates = location.coordinates
    if (!coordinates) {
      // Un local sin coordenadas en un lugar que sí tiene: por barrio, con la marca.
      const neighborhood = locationNeighborhood(location)
      const branch = neighborhood ? group.find((candidate) => candidate.neighborhoodId === neighborhood) : undefined
      if (branch) links.set(branch.placeId, link(branch, { locationIndex: index, reason: `dirección: ${location.address}` }))
      else {
        unmatched += 1
        if (!neighborhood) undecided += 1
      }
      continue
    }
    const near = rows
      .flatMap((row) => (row.location ? [{ row, meters: metersBetween(coordinates, row.location) }] : []))
      .filter((item) => item.meters <= NEAR_STRONG_METERS)
      .sort((a, b) => a.meters - b.meters)
    // Con señal fuerte (mismo nombre o Instagram) hasta 300 m; con sólo un nombre parecido, hasta 150 m; pegado (≤ 30 m),
    // con una palabra distintiva en común ("SUMI JAPANESE FOOD" y "Sumi Sushi", "REST FANS" y "Fans 26 de marzo").
    const shared = (row: MatchablePlace) => sharedDistinctiveWords(place.sourceName, row.name)
    const hit = near.find(({ row, meters }) => (byId.get(row.id)!.strong && meters <= NEAR_STRONG_METERS) || (similarity.get(row.id)! >= NEAR_NAME_MIN && meters <= NEAR_METERS) || (meters <= SAME_SPOT_METERS && shared(row).length > 0))
    if (hit) {
      const byWord = !byId.get(hit.row.id)!.strong && similarity.get(hit.row.id)! < NEAR_NAME_MIN
      const reason = `${metersLabel(hit.meters)} de ${location.address}${byWord ? `, comparten «${shared(hit.row).join(' ')}»` : ''}`
      if (!links.has(hit.row.id)) links.set(hit.row.id, link(byId.get(hit.row.id)!, { locationIndex: index, reason }))
      continue
    }
    // Un vecino con otro nombre no es candidato: queda como nota al leer (nearbyPlaces).
    unmatched += 1
  }
  // Cadena en parte: todos los locales con un lugar nuestro cerca cruzaron y los demás no tienen ninguno: encontrado
  // ("faltan sucursales en la base", missingBranches), no dudoso.
  if (links.size > 0 && undecided === 0) return { status: 'found', links: [...links.values()], candidates: [] }
  // Sin ningún vínculo: la marca, o un lugar de nombre parecido, lejos de todos los locales, es candidato con la
  // distancia. La marca primero.
  // Lejos, un nombre sólo parecido es ruido ("Almar" y "Bistró del Mar"): tiene que ser muy parecido.
  const similar = scored.filter((candidate) => similarity.get(candidate.placeId)! >= FAR_NAME_MIN).sort((a, b) => b.score - a.score)
  for (const candidate of links.size > 0 ? [] : [...group, ...similar.filter((item) => !group.some((member) => member.placeId === item.placeId))]) {
    if (links.has(candidate.placeId) || candidates.has(candidate.placeId)) continue
    const row = rows.find((item) => item.id === candidate.placeId)!
    const nearest = row.location
      ? Math.min(...locations.flatMap(({ location }) => (location.coordinates ? [metersBetween(location.coordinates, row.location!)] : [])))
      : null
    candidates.set(candidate.placeId, { ...strip(candidate), reasons: [...candidate.reasons, nearest !== null && Number.isFinite(nearest) ? `${metersLabel(nearest)} del local más cercano` : 'sin ubicación para comparar'] })
  }
  const list = [...candidates.values()].slice(0, MAX_CANDIDATES)
  if (unmatched === 0 && links.size > 0) return { status: 'found', links: [...links.values()], candidates: [] }
  if (links.size === 0 && list.length === 0) {
    // Nada cerca ni de la marca: candidatos por nombre parecido, como sin coordenadas.
    const close = scored.filter((candidate) => candidate.score >= DOUBTFUL_MIN).sort((a, b) => b.score - a.score)
    if (close.length > 0) return { status: 'doubtful', links: [], candidates: close.slice(0, MAX_CANDIDATES).map(strip) }
    return { status: 'missing', links: [], candidates: [] }
  }
  return { status: 'doubtful', links: [...links.values()], candidates: list }
}

/** Lugares nuestros a ≤ 150 m de algún local de Montevideo de la fuente que no están vinculados: una nota, no candidatos. */
export function nearbyPlaces(place: { montevideo: boolean; locations: ProviderPlaceLocation[] }, linked: Set<string>, rows: Pick<MatchablePlace, 'id' | 'name' | 'neighborhoodId' | 'location'>[]): NearbyPlace[] {
  if (!place.montevideo) return []
  const nearest = new Map<string, NearbyPlace>()
  for (const location of place.locations) {
    const coordinates = location.coordinates
    if (!coordinates || !isMontevideoLocation(location)) continue
    for (const row of rows) {
      if (!row.location || linked.has(row.id)) continue
      const meters = metersBetween(coordinates, row.location)
      if (meters > NEAR_METERS) continue
      const saved = nearest.get(row.id)
      if (!saved || meters < saved.meters) nearest.set(row.id, { placeId: row.id, name: row.name, neighborhoodId: row.neighborhoodId, meters: Math.round(meters), address: location.address })
    }
  }
  return [...nearest.values()].sort((a, b) => a.meters - b.meters).slice(0, MAX_NEARBY)
}

const MAX_NEARBY = 5

/** Agrega lo que se calcula al leer: `missingBranches` y `nearby` (con nuestros lugares de hoy). */
export function withReadDerived<T extends { montevideo: boolean; locations: ProviderPlaceLocation[]; match: Omit<DiscountMatch, 'missingBranches' | 'nearby'> }>(place: T, rows: Pick<MatchablePlace, 'id' | 'name' | 'neighborhoodId' | 'location'>[]): Omit<T, 'match'> & { match: DiscountMatch } {
  const linked = new Set(place.match.links.map((item) => item.placeId))
  return { ...place, match: { ...place.match, missingBranches: missingBranches(place, place.match), nearby: nearbyPlaces(place, linked, rows) } }
}
