import type { CandidateFilters, CandidateRow, NameMatch, ScoreInputs } from '../candidates'
import { openStatus } from '../hours'
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
    diet: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
    price: 'unknown',
    hours: { slots: [], status: 'none' },
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

/** Store en memoria con la misma semántica de filtros que el SQL, para probar el flujo completo. */
export function fakeStore(places: CandidateRow[], names: NameMatch[] = []) {
  const calls: { filters: CandidateFilters; scores: ScoreInputs }[] = []
  const matches = (place: CandidateRow, filters: CandidateFilters) => {
    const has = (place: CandidateRow, dish: string) => place.dishes.some((item) => item.includes(dish))
    return (
      (!filters.categories.length || filters.categories.some((id) => place.categories.includes(id))) &&
      filters.tags.every((id) => place.tags.includes(id)) &&
      filters.diet.every((key) => ['has_options', 'fully'].includes(place.diet[key])) &&
      (!filters.neighborhoods.length || filters.neighborhoods.includes(place.neighborhoodId)) &&
      (!filters.price.length || place.price === 'unknown' || (filters.price as string[]).includes(place.price)) &&
      (!filters.openAt || openStatus(place.hours, filters.openAt).state !== 'closed') &&
      !filters.excludeCategories.some((id) => place.categories.includes(id)) &&
      !filters.excludeTags.some((id) => place.tags.includes(id)) &&
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
    ...overrides,
  }
}

export function fakeCache(output: LlmInterpretation | Error = llmOutput()) {
  const interpreted: string[] = []
  const embedded: string[] = []
  const cache: SearchCache = {
    async interpret(normalized) {
      interpreted.push(normalized)
      if (output instanceof Error) throw output
      return { data: output, model: 'test-model' }
    },
    async embed(text) {
      embedded.push(text)
      return [0.1, 0.2]
    },
  }
  return { cache, interpreted, embedded }
}
