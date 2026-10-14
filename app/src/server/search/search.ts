import { findDef, label, normalize } from '@shared/tags.ts'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import centroids from '@shared/neighborhood-centroids.json'
import { SEARCH_CONFIG } from './config'
import type { EmbeddingResult, SearchCache } from './cache'
import type { CandidateFilters, DishMode, NameMatch, ScoreInputs } from './candidates'
import { summarizeCost, type CostEntry, type SearchCost } from './cost'
import { buildChips, type Chip } from './chips'
import { interpretWithDictionary } from './dictionary'
import { dishTargetFor, type DishTarget } from './dishes'
import { buildRankings, fuse, type Fused, type MatchLevel, type Rankings } from './fuse'
import { montevideoNow, openStatus, resolveOpenAt, type Moment, type OpenState } from './hours'
import {
  applyRemove,
  DIET_KEYS,
  emptyInterpretation,
  mentionsBest,
  mentionsNearMe,
  parseRemove,
  validateInterpretation,
  type Interpretation,
} from './interpretation'
import { openStateLabel } from './labels'
import { normalizeQuery, queryWords } from './normalize'
import { buildReasons } from './reasons'
import { canRelax, noMatchNotice, relax, RELAX_ORDER, relaxNotice, type NoticeKind, type RelaxStep, type SearchState } from './relax'
import type { PlacesStore } from './store'

export type SearchDeps = { store: PlacesStore; cache: SearchCache }
export type SearchOptions = { remove?: string | null; debug?: boolean; now?: Date }

export type SearchResult = {
  id: string
  slug: string
  name: string
  neighborhood: string
  categories: string[]
  lat: number
  lng: number
  reasons: string[]
  openStatus: { state: OpenState['state']; closesAt: string | null; label: string }
  matchLevel: MatchLevel
}

export type InterpretationSource = 'shortcut' | 'name' | 'llm' | 'fallback'

export type SearchDebug = {
  source: InterpretationSource
  model: string | null
  llmError: string | null
  /** Ids o barrios que mandó el modelo y no existen. */
  discarded: string[]
  original: Interpretation
  interpretation: Interpretation
  nameMatches: NameMatch[]
  semanticText: string | null
  keywords: string[]
  attempts: { relaxed: RelaxStep[]; dishMode: DishMode; candidates: number; matching: number; ms: number }[]
  rankings: Rankings
  results: {
    id: string
    name: string
    rrf: number
    boosts: Fused['boosts']
    baseScore: number
    prominence: number
    featured: boolean
    multiplier: number
    score: number
    positionWithoutQuality: number
    matchLevel: MatchLevel
    pinned: boolean
  }[]
  timings: Record<string, number>
  /** Lo que costó esta búsqueda en el AI Gateway (lo que vino de la cache cuenta 0). */
  cost: SearchCost
}

export type SearchResponse = {
  query: string
  interpreted: { chips: Chip[] }
  results: SearchResult[]
  relaxed: { what: NoticeKind; message: string }[]
  /** Con cero resultados: los chips de dieta o exclude que hay que sacar para que aparezcan lugares. */
  suggestedRemovals: Chip[]
  needsLocation: boolean
  debug?: SearchDebug
}

const STOPWORDS = new Set([
  'en', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'y', 'o', 'con', 'para', 'por', 'a', 'al', 'que', 'algo', 'lugar', 'no', 'sea', 'mejor', 'mejores', 'top',
  'in', 'at', 'near', 'the', 'an', 'with', 'for', 'and', 'or', 'of', 'to', 'best', 'place', 'me',
])

const CENTROIDS = centroids as Record<string, { lat: number; lng: number }>

/** Palabras de todos los nombres de un tag, para no buscar por keyword lo que se excluyó. */
function termWords(id: string): string[] {
  const definition = findDef(id)
  if (!definition) return [id]
  return [definition.label.es, definition.label.en, ...definition.synonyms.es, ...definition.synonyms.en].flatMap((name) => normalize(name).split(' '))
}

export function keywordsFor(normalized: string, value: Interpretation, removed: boolean): string[] {
  const excluded = new Set([...value.exclude.categories, ...value.exclude.tags].flatMap(termWords))
  const fromQuery = removed ? [] : queryWords(normalized)
  const words = [...value.dishes.flatMap((dish) => queryWords(normalize(dish.name))), ...fromQuery]
  return [...new Set(words)].filter((word) => word.length > 1 && !STOPWORDS.has(word) && !excluded.has(word))
}

/** Texto para el embedding: la vibe; si se quitaron chips, lo que quedó; si no, la consulta. */
export function semanticTextFor(normalized: string, value: Interpretation, removed: boolean): string | null {
  if (value.vibe) return value.vibe
  if (!removed) return normalized
  const parts = [
    ...value.must.categories.map((id) => label(id)),
    ...value.dishes.map((dish) => dish.name),
    ...[...value.must.tags, ...value.prefer.tags].map((id) => label(id)),
    ...value.must.neighborhoods.map((id) => neighborhoodDisplayName(id) ?? id),
  ]
  return parts.length ? parts.join(', ') : null
}

export function filtersFor(value: Interpretation, moment: Moment | null, dishes: DishTarget[], dishMode: DishMode = 'dish'): CandidateFilters {
  return {
    categories: value.must.categories,
    tags: value.must.tags,
    diet: DIET_KEYS.filter((key) => value.must.diet[key]),
    neighborhoods: value.must.neighborhoods,
    price: value.must.price,
    openAt: moment,
    excludeCategories: value.exclude.categories,
    excludeTags: value.exclude.tags,
    dishes,
    dishMode,
  }
}

/** Lugar que va primero por nombre. Con la consulta resuelta por el diccionario hace falta casi el nombre exacto. */
export function strongNameMatch(matches: NameMatch[], query: string, structured: boolean): NameMatch | null {
  const { name } = SEARCH_CONFIG
  if (query.length < name.minStrongLength) return null
  const best = matches[0]
  if (!best) return null
  if (structured) return best.similarity >= name.strongSimilarityWhenStructured ? best : null
  return best.similarity >= name.strongSimilarity || best.wordSimilarity >= name.strongWordSimilarity ? best : null
}

/**
 * Qué impide encontrar lugares cuando ya se relajó todo: la dieta, los exclude o la combinación.
 * Con los dos en cero por separado (o los dos con lugares pero ninguno con ambos) se marcan los dos.
 */
async function blockingConditions(store: SearchDeps['store'], filters: CandidateFilters) {
  const hasDiet = filters.diet.length > 0
  const hasExclude = filters.excludeCategories.length + filters.excludeTags.length > 0
  const none: CandidateFilters = { ...filters, diet: [], excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'none' }
  const [withDiet, withExclude] = await Promise.all([
    hasDiet ? store.count({ ...none, diet: filters.diet }) : null,
    hasExclude ? store.count({ ...none, excludeCategories: filters.excludeCategories, excludeTags: filters.excludeTags }) : null,
  ])
  const dietBlocks = withDiet === 0
  const excludeBlocks = withExclude === 0
  if (dietBlocks || excludeBlocks) return { diet: dietBlocks, exclude: excludeBlocks }
  return { diet: hasDiet, exclude: hasExclude }
}

const elapsed = (start: number) => Math.round(performance.now() - start)
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function runSearch(rawQuery: string, deps: SearchDeps, options: SearchOptions = {}): Promise<SearchResponse> {
  const started = performance.now()
  const startedAt = Date.now()
  const costs: CostEntry[] = []
  const priced = <T extends { model: string; cost: number | null; computedAt: number }>(step: CostEntry['step'], result: T) => {
    costs.push({ step, model: result.model, usd: result.cost, cached: result.computedAt < startedAt })
    return result
  }
  const timings: Record<string, number> = {}
  const now = options.now ?? new Date()
  const today = montevideoNow(now).day
  const normalized = normalizeQuery(rawQuery)
  const removals = parseRemove(options.remove)

  if (!normalized) {
    return { query: rawQuery, interpreted: { chips: [] }, results: [], relaxed: [], suggestedRemovals: [], needsLocation: false }
  }

  // El embedding de la consulta arranca ya: si no hay vibe ni chips quitados es el que se usa.
  const removed = removals.length > 0
  const queryEmbedding = removed ? null : deps.cache.embed(normalized).then((result) => priced('embed', result)).catch(() => null)

  // 1. Interpretación: diccionario, nombre fuerte o modelo.
  let step = performance.now()
  const dictionary = interpretWithDictionary(normalized)
  let nameMatches = await deps.store.nameMatches(normalized).catch(() => [] as NameMatch[])
  let pinned = strongNameMatch(nameMatches, normalized, dictionary !== null)
  timings.shortcut = elapsed(step)

  let source: InterpretationSource
  let original: Interpretation
  let discarded: string[] = []
  let model: string | null = null
  let llmError: string | null = null
  step = performance.now()
  if (dictionary) {
    source = 'shortcut'
    original = dictionary
  } else if (pinned) {
    source = 'name'
    original = { ...emptyInterpretation(), nameQuery: normalized }
  } else {
    try {
      const llm = priced('interpret', await deps.cache.interpret(normalized))
      const validation = validateInterpretation(llm.data)
      source = 'llm'
      original = validation.interpretation
      discarded = validation.discarded
      model = llm.model
    } catch (error) {
      // Sin modelo, la búsqueda sigue con nombre, palabras y embedding de la consulta.
      source = 'fallback'
      llmError = errorMessage(error)
      costs.push({ step: 'interpret', model: SEARCH_CONFIG.llm.model, usd: null, cached: false })
      original = { ...emptyInterpretation(), nameQuery: normalized, needsLocation: mentionsNearMe(normalized), wantsBest: mentionsBest(normalized) }
    }
  }
  timings.interpret = elapsed(step)

  // El modelo puede corregir el nombre ("cardnal" → "cardinal").
  const nameQuery = original.nameQuery ? normalizeQuery(original.nameQuery) : null
  if (!pinned && nameQuery && nameQuery !== normalized) {
    step = performance.now()
    const corrected = await deps.store.nameMatches(nameQuery).catch(() => [] as NameMatch[])
    pinned = strongNameMatch(corrected, nameQuery, false)
    if (corrected.length) nameMatches = corrected
    timings.nameRetry = elapsed(step)
  }

  const interpretation = applyRemove(original, removals)
  if (removals.some((removal) => removal.kind === 'name')) pinned = null

  // 2. Embedding del texto semántico; si falla, se sigue sin el ranking semántico.
  step = performance.now()
  const semanticText = semanticTextFor(normalized, interpretation, removed)
  const embedded: EmbeddingResult | null =
    semanticText === null ? null
    : semanticText === normalized && queryEmbedding ? await queryEmbedding
    : await deps.cache.embed(semanticText).then((result) => priced('embed', result)).catch(() => null)
  const embedding = embedded?.embedding ?? null
  timings.embed = elapsed(step)

  const dishes = interpretation.dishes.map(dishTargetFor)
  const keywords = keywordsFor(normalized, interpretation, removed)
  const scores: ScoreInputs = {
    embedding,
    keywords,
    name: nameQuery ?? normalized,
    origins: [],
    pinnedId: pinned?.id ?? null,
  }

  // 3. Candidatos, relajando de a un paso mientras no haya ninguno.
  const relaxedSteps: RelaxStep[] = []
  const attempts: SearchDebug['attempts'] = []
  let state: SearchState = { interpretation, dishMode: 'dish' }
  const filtersOf = (value: SearchState) => filtersFor(value.interpretation, resolveOpenAt(value.interpretation.must.openAt, now), dishes, value.dishMode)
  const fetchCandidates = async () => {
    const attemptStart = performance.now()
    const result = await deps.store.candidates(filtersOf(state), scores)
    attempts.push({ relaxed: [...relaxedSteps], dishMode: state.dishMode, candidates: result.length, matching: result.filter((row) => row.matchesFilters).length, ms: elapsed(attemptStart) })
    return result
  }
  let rows = await fetchCandidates()
  for (const relaxStep of RELAX_ORDER) {
    if (rows.some((row) => row.matchesFilters) || !canRelax(state, relaxStep, dishes)) continue
    if (relaxStep === 'neighborhood') {
      scores.origins = state.interpretation.must.neighborhoods.flatMap((id) => (CENTROIDS[id] ? [CENTROIDS[id]] : []))
    }
    state = relax(state, relaxStep)
    relaxedSteps.push(relaxStep)
    rows = await fetchCandidates()
  }
  timings.candidates = attempts.reduce((sum, attempt) => sum + attempt.ms, 0)
  const current = state.interpretation

  // 4. Rankings, fusión y empujones.
  step = performance.now()
  const openAtMoment = resolveOpenAt(current.must.openAt, now)
  const relatedTags = state.dishMode === 'related' ? dishes.flatMap((target) => target.related.tags) : dishes.flatMap((target) => (target.tag ? [target.tag] : []))
  const rankings = buildRankings(rows)
  const fused = fuse(rows, rankings, {
    pinnedId: pinned?.id ?? null,
    dishes,
    categories: [...current.must.categories, ...current.prefer.categories],
    requestedTags: [...current.must.tags, ...current.prefer.tags, ...relatedTags],
    preferTags: current.prefer.tags,
    openAt: openAtMoment,
    wantsBest: current.wantsBest,
  }).slice(0, SEARCH_CONFIG.maxResults)
  timings.fuse = elapsed(step)

  // 5. Respuesta.
  const moment = openAtMoment ?? montevideoNow(now)
  const isNow = current.must.openAt === null || current.must.openAt === 'now'
  const results = fused.map((item): SearchResult => {
    const open = item.open ?? openStatus(item.row.hours, moment)
    return {
      id: item.row.id,
      slug: item.row.slug,
      name: item.row.name,
      neighborhood: neighborhoodDisplayName(item.row.neighborhoodId) ?? item.row.neighborhoodId,
      categories: item.row.categories,
      lat: item.row.lat,
      lng: item.row.lng,
      reasons: buildReasons(item, { interpretation: current, dishes, dishMode: state.dishMode, moment, isNow, open }),
      openStatus: {
        state: open.state,
        closesAt: open.state === 'open' ? open.closesAt : null,
        label: openStateLabel(open, interpretation.language, moment, isNow),
      },
      matchLevel: item.matchLevel,
    }
  })

  // Avisos: cada paso se arma con el estado previo y sólo si algún resultado no cumple lo relajado.
  const shownRows = fused.filter((item) => !item.pinned).map((item) => item.row)
  const relaxed: SearchResponse['relaxed'] = []
  let before: SearchState = { interpretation, dishMode: 'dish' }
  for (const relaxStep of relaxedSteps) {
    const notice = relaxNotice(relaxStep, {
      before,
      after: state,
      rows: shownRows,
      dishes,
      moment: resolveOpenAt(before.interpretation.must.openAt, now),
    })
    if (notice && shownRows.length) relaxed.push(notice)
    before = relax(before, relaxStep)
  }

  // Cero resultados: sólo pueden bloquear la dieta o los exclude, que nunca se relajan.
  let suggestedRemovals: Chip[] = []
  if (shownRows.length === 0) {
    step = performance.now()
    const blocking = await blockingConditions(deps.store, filtersOf(state))
    const chips = buildChips(interpretation, today)
    suggestedRemovals = chips.filter((chip) => (blocking.diet && chip.kind === 'diet') || (blocking.exclude && chip.kind === 'exclude'))
    relaxed.push(noMatchNotice(interpretation, blocking))
    timings.diagnose = elapsed(step)
  }
  timings.total = elapsed(started)

  const response: SearchResponse = {
    query: rawQuery,
    interpreted: { chips: buildChips(interpretation, today) },
    results,
    relaxed,
    suggestedRemovals,
    needsLocation: interpretation.needsLocation,
  }
  if (options.debug) {
    // El embedding de la consulta se pagó aunque al final se usara el de la vibe.
    await queryEmbedding
    const depth = SEARCH_CONFIG.debugDepth
    response.debug = {
      source,
      model,
      llmError,
      discarded,
      original,
      interpretation,
      nameMatches,
      semanticText,
      keywords,
      attempts,
      rankings: {
        semantic: rankings.semantic.slice(0, depth),
        keyword: rankings.keyword.slice(0, depth),
        name: rankings.name.slice(0, depth),
        distance: rankings.distance.slice(0, depth),
      },
      results: fused.map((item) => ({
        id: item.row.id,
        name: item.row.name,
        rrf: item.rrf,
        boosts: item.boosts,
        baseScore: item.baseScore,
        prominence: item.row.prominence,
        featured: item.row.featured,
        multiplier: item.multiplier,
        score: item.score,
        positionWithoutQuality: item.positionWithoutQuality,
        matchLevel: item.matchLevel,
        pinned: item.pinned,
      })),
      timings,
      cost: summarizeCost(costs),
    }
  }
  return response
}
