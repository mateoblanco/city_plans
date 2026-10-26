import type { CandidateFilters, CandidateRow, NameMatch, ScoreInputs } from '../candidates'
import { openStatus, opensToday, type OpenFilter } from '../hours'
import { matchesGroup } from '../intents'
import type { LlmInterpretation } from '../interpretation'
import type { SearchCache } from '../cache'
import type { PlacesStore } from '../store'

export function row(overrides: Partial<CandidateRow> & { id: string }): CandidateRow {
  return {
    slug: overrides.id,
    name: overrides.id,
    neighborhoodId: 'CORDON',
    categories: ['restaurant'],
    tags: [],
    signature: [],
    dishes: [],
    style: null,
    diet: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
    price: 'unknown',
    hours: { slots: [], status: 'none' },
    prominence: 0,
    featured: false,
    iconCategory: null,
    logoKey: null,
    logoBgColor: null,
    brandKey: null,
    brandCount: 1,
    lat: -34.9011,
    lng: -56.1645,
    matchesFilters: true,
    semantic: 0.5,
    keyword: 0,
    nameScore: 0,
    distance: null,
    dishHas: [],
    dishExact: [],
    ...overrides,
  }
}

export const everyDay = (opens: string, closes: string | null) => ({
  slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opens, closes })),
  status: 'exact' as const,
})

const cosine = (a: number[], b: number[]) => {
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0)
  const norm = (vector: number[]) => Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return dot / (norm(a) * norm(b))
}

/**
 * Store en memoria con la misma semántica de filtros que el SQL, para probar el flujo completo. vectors: el embedding
 * de cada lugar (vectores chicos), para los likes; un lugar sin vector es como uno sin embedding.
 */
export function fakeStore(places: CandidateRow[], names: NameMatch[] = [], vectors: Record<string, number[]> = {}) {
  const calls: { filters: CandidateFilters; scores: ScoreInputs }[] = []
  // Misma regla que openAtSql / opensTodaySql.
  const matchesOpenAt = (place: CandidateRow, { moment, today, night }: OpenFilter) =>
    today && moment.time ? opensToday(place.hours, { day: moment.day, time: moment.time }, night) !== 'no' : openStatus(place.hours, moment).state !== 'closed'
  const matches = (place: CandidateRow, filters: CandidateFilters) => {
    const has = (place: CandidateRow, dish: string) => place.dishes.some((item) => item.includes(dish))
    return (
      (!filters.categories.length || filters.categories.some((id) => place.categories.includes(id))) &&
      filters.tags.every((id) => place.tags.includes(id)) &&
      filters.diet.every((key) => ['has_options', 'fully'].includes(place.diet[key])) &&
      (!filters.neighborhoods.length || filters.neighborhoods.includes(place.neighborhoodId)) &&
      (!filters.price.length || place.price === 'unknown' || (filters.price as string[]).includes(place.price)) &&
      (!filters.openAt || matchesOpenAt(place, filters.openAt)) &&
      !filters.excludeCategories.some((id) => place.categories.includes(id)) &&
      !filters.excludeTags.some((id) => place.tags.includes(id)) &&
      filters.groups.every((group) => matchesGroup(group, place)) &&
      (!filters.near || (place.distance ?? Infinity) <= filters.near.radiusM) &&
      (!filters.dishes.length || filters.dishMode === 'none' ||
        (filters.dishMode === 'related'
          ? filters.dishes.some((target) => target.related.tags.some((id) => place.tags.includes(id)) || target.related.categories.some((id) => place.categories.includes(id)))
          : filters.dishes.some((target) => has(place, target.dish) || (target.tag !== null && place.tags.includes(target.tag)) || (target.category !== null && place.categories.includes(target.category)))))
    )
  }
  const store: PlacesStore = {
    async candidates(filters, scores) {
      calls.push({ filters: structuredClone(filters), scores: structuredClone(scores) })
      return places.flatMap((place) => {
        const ok = matches(place, filters)
        if (!ok && place.id !== scores.pinnedId) return []
        return [{
          ...place,
          matchesFilters: ok,
          dishHas: filters.dishes.map((target) => place.dishes.some((item) => item.includes(target.dish))),
          dishExact: filters.dishes.map((target) => place.dishes.includes(target.dish)),
          distance: scores.origins.length ? place.distance ?? 1000 : null,
        }]
      })
    },
    async nameMatches() {
      return names
    },
    async count(filters) {
      return places.filter((place) => matches(place, filters)).length
    },
    async neighborhoods() {
      return [...new Set(places.map((place) => place.neighborhoodId))].sort()
    },
    // Misma regla que likeSimilaritiesQuery: likes publicados con embedding, su promedio, el coseno con cada uno y,
    // por like, el percentil de su parecido con el resto de la base (percentile_cont: interpolación lineal).
    async likeSimilarities(likeIds, candidateIds, percentile) {
      const liked = places.filter((place) => likeIds.includes(place.id) && vectors[place.id])
      const topCut = (id: string) => {
        const values = places.filter((place) => place.id !== id && vectors[place.id]).map((place) => cosine(vectors[place.id], vectors[id])).sort((a, b) => a - b)
        if (!values.length) return null
        const position = percentile * (values.length - 1)
        const lower = Math.floor(position)
        return values[lower] + (position - lower) * ((values[lower + 1] ?? values[lower]) - values[lower])
      }
      const profile = liked.length ? vectors[liked[0].id].map((_, index) => liked.reduce((sum, place) => sum + vectors[place.id][index], 0) / liked.length) : null
      return {
        liked: liked.map((place) => ({ id: place.id, name: place.name, topCut: topCut(place.id) })),
        rows: candidateIds.flatMap((id) => {
          const vector = vectors[id]
          if (!vector) return []
          return [{
            id,
            profile: profile ? cosine(vector, profile) : null,
            byLike: Object.fromEntries(liked.map((place) => [place.id, cosine(vector, vectors[place.id])])),
          }]
        }),
      }
    },
  }
  return { store, calls }
}

export function llmOutput(overrides: Partial<LlmInterpretation> = {}): LlmInterpretation {
  return {
    nameQuery: null,
    must: { categories: [], tags: [], diet: { vegan: false, vegetarian: false, glutenFree: false }, neighborhoods: [], price: [], openAt: null },
    prefer: { categories: [], tags: [] },
    exclude: { categories: [], tags: [] },
    dishes: [],
    vibe: null,
    language: 'es',
    unrecognized: [],
    wantsBest: false,
    intent: null,
    sections: [],
    ...overrides,
  }
}

/** computedAt anterior a la búsqueda simula un acierto de cache. */
export function fakeCache(output: LlmInterpretation | Error = llmOutput(), { cost = 0.001, computedAt }: { cost?: number | null; computedAt?: number } = {}) {
  const interpreted: string[] = []
  const embedded: string[] = []
  const cache: SearchCache = {
    async interpret(normalized) {
      interpreted.push(normalized)
      if (output instanceof Error) throw output
      return { data: output, model: 'test-model', cost, computedAt: computedAt ?? Date.now() }
    },
    async embed(text) {
      embedded.push(text)
      return { embedding: [0.1, 0.2], model: 'test-embedding', cost: cost === null ? null : cost / 100, computedAt: computedAt ?? Date.now() }
    },
  }
  return { cache, interpreted, embedded }
}
