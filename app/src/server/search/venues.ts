import { neighborhoodsIn, resolveNeighborhood } from '@shared/neighborhood-aliases.ts'
import type { Interpretation } from './interpretation'
import type { Discard } from './invariant'
import { normalizeQuery } from './normalize'

/** Un valor de located_in de los publicados ("Mercado del Puerto") y dónde están los locales que lo tienen. */
export type Venue = { name: string; points: { lat: number; lng: number }[] }

// Palabras que no cuentan al comparar: "el mercado del puerto" = "mercado puerto".
const FILLER = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'the', 'of'])

/** Palabras con contenido y su posición en el texto completo. */
const contentWords = (text: string) =>
  normalizeQuery(text)
    .split(' ')
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => word && !FILLER.has(word))

/** Dónde empiezan las palabras de needle seguidas dentro de haystack; -1 si no están. */
function findRun(haystack: string[], needle: string[]): number {
  if (!needle.length) return -1
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((word, offset) => haystack[start + offset] === word)) return start
  }
  return -1
}

const covers = (outer: string, inner: string) => findRun(contentWords(outer).map(({ word }) => word), contentWords(inner).map(({ word }) => word)) >= 0

/**
 * Venues que nombra el texto, sin tildes, mayúsculas ni artículos ("comer en el mercado del puerto" → Mercado del
 * Puerto), y las palabras del texto que ocupan. Un venue que también es un barrio queda para el barrio.
 */
export function venuesIn(normalized: string, venues: Venue[]): { venues: Venue[]; spans: [number, number][] } {
  const text = contentWords(normalized)
  const words = text.map(({ word }) => word)
  const found: Venue[] = []
  const spans: [number, number][] = []
  for (const venue of venues) {
    if (resolveNeighborhood(venue.name)) continue
    const needle = contentWords(venue.name).map(({ word }) => word)
    const start = findRun(words, needle)
    if (start < 0) continue
    found.push(venue)
    spans.push([text[start].index, text[start + needle.length - 1].index])
  }
  return { venues: found, spans }
}

/**
 * El venue nombrado en el texto va a must.venues: filtra por sus locales y los que están cerca (candidates.ts). Deja
 * de estar sin reconocer y de ser un nombre de lugar; un barrio que el texto sólo dice dentro del venue
 * ("punta carretas shopping") se descarta. Sin venue, la interpretación queda igual.
 */
export function applyVenues(value: Interpretation, normalized: string, venues: Venue[]): { interpretation: Interpretation; discarded: Discard[] } {
  const found = venuesIn(normalized, venues)
  if (!found.venues.length) return { interpretation: value, discarded: [] }
  const names = found.venues.map((venue) => venue.name)
  const inVenue = (part: string) => names.some((name) => covers(part, name) || covers(name, part))
  const outside = normalized
    .split(' ')
    .filter((_, index) => !found.spans.some(([from, to]) => index >= from && index <= to))
    .join(' ')
  const named = neighborhoodsIn(outside)
  const dropped = value.must.neighborhoods.filter((id) => !named.has(id))
  const interpretation: Interpretation = {
    ...value,
    nameQuery: value.nameQuery && inVenue(value.nameQuery) ? null : value.nameQuery,
    must: { ...value.must, neighborhoods: value.must.neighborhoods.filter((id) => named.has(id)), venues: [...new Set([...value.must.venues, ...names])] },
    unrecognized: value.unrecognized.filter((part) => !inVenue(part)),
  }
  return { interpretation, discarded: dropped.map((id) => ({ value: `neighborhood:${id}`, reason: `el texto lo nombra como parte de ${names.join(', ')}` })) }
}
