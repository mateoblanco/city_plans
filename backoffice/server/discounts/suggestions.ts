import { nameSimilarity } from '../../src/lib/discount-names.ts'
import type { OurPlaceOption } from '../../src/types/discounts.ts'
import { instagramKey } from '../places/brand-key.ts'
import { metersBetween, NEAR_STRONG_METERS, type MatchablePlace } from './match.ts'
import { DOUBTFUL_NAME_MIN } from './place-search.ts'

// Sugerencias del panel «Resolver» (sección "Buscar en mis lugares", sin escribir nada). Puro.

/** Lo que se sabe del lugar del banco. `candidateIds`: los candidatos del cruce (un dudoso). */
export type SuggestionTarget = {
  name: string
  coordinates: { lat: number; lng: number } | null
  instagram: string | null
  candidateIds?: string[]
}

export type Suggestion = { placeId: string; meters: number | null; score: number; reason: NonNullable<OurPlaceOption['reason']> }

export const MAX_NEAR_SUGGESTIONS = 10
export const MAX_NAME_SUGGESTIONS = 8

/**
 * Candidatos del cruce primero, después los del mismo Instagram, los que están a ≤ 300 m del local (aunque el nombre sea
 * otro; por distancia) y los nombres más parecidos (≥ 0,45, por puntaje). Sin repetir: cada uno con su primer motivo,
 * y siempre con la distancia (si hay coordenadas) y el puntaje del nombre.
 */
export function suggestOurPlaces(target: SuggestionTarget, places: MatchablePlace[]): Suggestion[] {
  const handle = instagramKey(target.instagram)
  const scored = places.map((place) => ({
    place,
    score: Math.round(nameSimilarity(place.name, target.name) * 100) / 100,
    meters: target.coordinates && place.location ? Math.round(metersBetween(target.coordinates, place.location)) : null,
  }))
  const byId = new Map(scored.map((item) => [item.place.id, item]))
  const out = new Map<string, Suggestion>()
  const add = (items: typeof scored, reason: Suggestion['reason']) => {
    for (const item of items) if (!out.has(item.place.id)) out.set(item.place.id, { placeId: item.place.id, meters: item.meters, score: item.score, reason })
  }
  add((target.candidateIds ?? []).flatMap((id) => byId.get(id) ?? []), 'candidate')
  if (handle) add(scored.filter((item) => instagramKey(item.place.instagram) === handle), 'instagram')
  add(scored.filter((item) => item.meters !== null && item.meters <= NEAR_STRONG_METERS).sort((a, b) => a.meters! - b.meters!).slice(0, MAX_NEAR_SUGGESTIONS), 'near')
  add(scored.filter((item) => item.score >= DOUBTFUL_NAME_MIN).sort((a, b) => b.score - a.score || (a.meters ?? Infinity) - (b.meters ?? Infinity)).slice(0, MAX_NAME_SUGGESTIONS), 'name')
  return [...out.values()]
}
