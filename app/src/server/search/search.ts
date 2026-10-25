import { findDef, isOccasionTag, isStyleId, label, normalize } from '@shared/tags.ts'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { sectionDef } from '@shared/sections.ts'
import { INTENT_VERB_WORDS } from '@shared/intents.ts'
import centroids from '@shared/neighborhood-centroids.json'
import type { IconCategory } from '@shared/icon-categories.ts'
import { SEARCH_CONFIG } from './config'
import type { EmbeddingResult, SearchCache } from './cache'
import type { CandidateFilters, CandidateRow, DishMode, FilterGroup, NameMatch, ScoreInputs } from './candidates'
import { summarizeCost, type CostEntry, type SearchCost } from './cost'
import { collapseBranches } from './branches'
import { buildChips, type Chip } from './chips'
import { interpretWithDictionary } from './dictionary'
import { checkMust, intendedDiscards, reportMust, type Discard, type MustCheck } from './invariant'
import { dishTargetFor, type DishTarget } from './dishes'
import { applyFilters, filterChipKeys, parseFilters, parseNear, type LatLng } from './filters'
import { buildBar, intentGroups, parseIntent, resolveIntent, type IntentBar } from './intents'
import { buildRankings, fuse, type Fused, type MatchLevel, type Rankings } from './fuse'
import { montevideoNow, nextOpening, openStatus, resolveOpenAt, type OpenFilter, type OpenState } from './hours'
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
import { openStateLabel, openStateText, type OpenStateText } from './labels'
import { normalizeQuery, queryWords } from './normalize'
import { buildReasons } from './reasons'
import { logoUrl } from './logo'
import { relevanceCut, type Relevance } from './relevance'
import { buildSections, notBroadReason, requestedSections, type Section, type SectionsDebug } from './sections'
import { canRelax, noMatchNotice, relax, RELAX_ORDER, relaxNotice, type NoticeKind, type RelaxStep, type SearchState } from './relax'
import type { PlacesStore } from './store'

export type SearchDeps = { store: PlacesStore; cache: SearchCache }
/** filters: `f` de la URL (barra de filtros); near: `near=lat,lng` (cerca mío); intent / sub: intención y sub-filtros. */
export type SearchOptions = {
  remove?: string | null
  filters?: string | null
  near?: string | null
  intent?: string | null
  sub?: string | null
  debug?: boolean
  /** Contar cuántos lugares más saldrían sin cada filtro activo (la invitación a ampliar del final de la lista). */
  widen?: boolean
  now?: Date
}

/**
 * Invitación a ampliar: sacar este filtro suma count lugares. kind sub es un sub-filtro de la intención; el resto,
 * chips (fromText / fromFilter dicen cómo apagarlo).
 */
export type WidenOption = { kind: 'neighborhood' | 'openAt' | 'diet' | 'sub'; id: string; label: string; fromText: boolean; fromFilter: boolean; count: number }

export type SearchResult = {
  id: string
  slug: string
  name: string
  neighborhood: string
  categories: string[]
  /** Clave de shared/icon-categories.ts (null = todavía sin categoría); el emoji lo dibuja PlaceIcon. */
  iconCategory: IconCategory | null
  /** Clave del logo en R2 (null = sin logo). */
  logoKey: string | null
  /** LOGO_BASE_URL + "/" + logoKey, armada acá porque la card es de cliente y no ve la variable. */
  logoUrl: string | null
  /** Fondo del banner del logo (#rrggbb) o null. */
  logoBgColor: string | null
  lat: number
  lng: number
  /** Sucursales publicadas de la marca (1 sin marca), para "N sucursales". */
  branchCount: number
  /** Las otras sucursales de la marca que salieron en la búsqueda: no tienen card, sí punto en el mapa. */
  branches: { id: string; lat: number; lng: number }[]
  reasons: string[]
  openStatus: { state: OpenState['state']; closesAt: string | null; label: string } & OpenStateText
  matchLevel: MatchLevel
}

/** filters: sin texto, sólo con la barra de filtros o cerca mío (sin modelo ni embedding). */
export type InterpretationSource = 'shortcut' | 'name' | 'llm' | 'fallback' | 'filters'

export type SearchDebug = {
  source: InterpretationSource
  model: string | null
  llmError: string | null
  /** Lo que no llegó a la interpretación final, con el motivo: ids o barrios del modelo que no existen, chips quitados… */
  discarded: Discard[]
  /** Invariante: dónde terminó cada cosa exigida por el texto (filtro, intención o descartada). */
  must: MustCheck
  /** Votos de cada intención según el texto (la que más tiene, sin empate, se elige sola). */
  intentVotes: Partial<Record<string, number>>
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
    /** Datos del lugar para verificar resultados (search:check). */
    categories: string[]
    tags: string[]
    diet: CandidateRow['diet']
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
    /** Similitud semántica con la consulta (coseno); null sin embedding. */
    similarity: number | null
    /** Por qué pasó el corte por relevancia, o por qué se cortó (los cortados van al final). */
    relevance: Relevance
    brandKey: string | null
    /** Sucursal escondida: el id de la card de su marca; null si tiene card propia (o quedó cortada). */
    collapsedInto: string | null
  }[]
  /** Corte por relevancia: la similitud más alta y desde dónde se corta; null si no hubo embedding. */
  relevance: { best: number; threshold: number; gap: number } | null
  timings: Record<string, number>
  /** Lo que costó esta búsqueda en el AI Gateway (lo que vino de la cache cuenta 0). */
  cost: SearchCost
  /** Si se agrupó: de dónde salieron los grupos, los elegidos y los descartados por chicos; si no, por qué no. */
  sections: SectionsDebug
}

export type SearchResponse = {
  query: string
  interpreted: { chips: Chip[] }
  /** Intención, sub-filtros y lo que pidió el texto sin botón propio: lo que muestra la barra. */
  bar: IntentBar
  results: SearchResult[]
  /**
   * Búsqueda amplia con suficientes resultados: los mismos resultados en secciones con título (ids de results, cada
   * uno una sola vez). null: la lista de siempre.
   */
  sections: Section[] | null
  relaxed: { what: NoticeKind; message: string }[]
  /** Con cero resultados: los chips de dieta o exclude que hay que sacar para que aparezcan lugares. */
  suggestedRemovals: Chip[]
  needsLocation: boolean
  /** Ubicación con la que se buscó (ya redondeada), para el mapa. */
  near: LatLng | null
  /** Sólo con la opción widen: hasta WIDEN_MAX filtros para sacar, de los que más suman a los que menos (count > 0). */
  widen?: WidenOption[]
  debug?: SearchDebug
}

const STOPWORDS = new Set([
  'en', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'uno', 'unos', 'unas', 'y', 'o', 'con', 'para', 'por', 'a', 'al', 'que', 'algo', 'lugar', 'no', 'sea', 'mejor', 'mejores', 'top',
  'in', 'at', 'near', 'the', 'an', 'with', 'for', 'and', 'or', 'of', 'to', 'best', 'place', 'me',
])

const CENTROIDS = centroids as Record<string, { lat: number; lng: number }>

/** Palabras de todos los nombres de un tag, para no buscar por keyword lo que se excluyó. */
function termWords(id: string): string[] {
  const definition = findDef(id)
  if (!definition) return [id]
  return [definition.label.es, definition.label.en, ...definition.synonyms.es, ...definition.synonyms.en].flatMap((name) => normalize(name).split(' '))
}

/** Qué cambió del texto: chips quitados (sus palabras se sacan de la consulta) y si la consulta la resolvió el diccionario. */
export type TextEdits = { removed: boolean; removedWords: Set<string>; shortcut: boolean }

/** Palabras de un chip quitado del texto ("Pizza ×" → pizza), para no seguir buscándolo por embedding ni keyword. */
export function removedWordsOf(removals: { kind: string; id: string }[]): Set<string> {
  return new Set(
    removals.flatMap(({ kind, id }) => {
      if (kind === 'category' || kind === 'tag' || kind === 'prefer') return termWords(id)
      if (kind === 'dish') return queryWords(normalize(id))
      if (kind === 'neighborhood') return queryWords(normalize(neighborhoodDisplayName(id) ?? id))
      return []
    }),
  )
}

export function keywordsFor(normalized: string, value: Interpretation, edits: TextEdits): string[] {
  const excluded = new Set([...value.exclude.categories, ...value.exclude.tags].flatMap(termWords))
  // Con el atajo, la consulta es lo que pidió la persona (menos lo quitado); con el modelo y chips quitados, sólo los platos.
  const fromQuery = edits.removed && !edits.shortcut ? [] : queryWords(normalized).filter((word) => !edits.removedWords.has(word))
  const words = [...value.dishes.flatMap((dish) => queryWords(normalize(dish.name))), ...fromQuery]
  // El verbo que eligió la intención ("tomar algo") ya hizo su trabajo: como keyword empata a casi todos.
  const verb = (word: string) => value.intent !== null && INTENT_VERB_WORDS.has(word)
  return [...new Set(words)].filter((word) => word.length > 1 && !STOPWORDS.has(word) && !excluded.has(word) && !verb(word))
}

/**
 * Palabras para buscar por nombre: la consulta sin palabras vacías, sin los verbos de intención ("comer algo" → nada)
 * y sin las de los chips quitados. Sin ninguna, la búsqueda por nombre no corre.
 */
export function nameWordsFor(normalized: string, removedWords: Set<string>): string[] {
  return [...new Set(queryWords(normalized))].filter((word) => !STOPWORDS.has(word) && !INTENT_VERB_WORDS.has(word) && !removedWords.has(word))
}

/**
 * Texto para el embedding: la vibe; con el atajo, la consulta sin las palabras de los chips quitados; con el modelo
 * y chips quitados, lo que quedó (labels); si no, la consulta.
 */
export function semanticTextFor(normalized: string, value: Interpretation, edits: TextEdits): string | null {
  if (value.vibe) return value.vibe
  if (!edits.removed) return normalized
  if (edits.shortcut) {
    const words = normalized.split(' ').filter((word) => word && !edits.removedWords.has(word))
    // Sin las palabras vacías que quedaron colgando ("cafés con terraza en cordón" − terraza, cordón → "cafes").
    while (words.length && STOPWORDS.has(words[words.length - 1])) words.pop()
    while (words.length && STOPWORDS.has(words[0])) words.shift()
    return words.length ? words.join(' ') : null
  }
  const parts = [
    ...[...value.must.categories, ...value.prefer.categories].map((id) => label(id)),
    ...value.dishes.map((dish) => dish.name),
    ...[...value.must.tags, ...value.prefer.tags].map((id) => label(id)),
    ...(value.prefer.style ? [label(value.prefer.style)] : []),
    ...value.must.neighborhoods.map((id) => neighborhoodDisplayName(id) ?? id),
  ]
  return parts.length ? parts.join(', ') : null
}

export function filtersFor(
  value: Interpretation,
  openAt: OpenFilter | null,
  dishes: DishTarget[],
  dishMode: DishMode = 'dish',
  near: CandidateFilters['near'] = null,
  groups: CandidateFilters['groups'] = [],
): CandidateFilters {
  return {
    categories: value.must.categories,
    tags: value.must.tags,
    diet: DIET_KEYS.filter((key) => value.must.diet[key]),
    neighborhoods: value.must.neighborhoods,
    price: value.must.price,
    openAt,
    excludeCategories: value.exclude.categories,
    excludeTags: value.exclude.tags,
    dishes,
    dishMode,
    near,
    groups,
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
 * Qué impide encontrar lugares cuando ya se relajó todo: la dieta, los exclude, la intención o la combinación.
 * Se marcan los que dan cero por separado; si ninguno da cero, es la combinación y se marcan todos los pedidos.
 */
async function blockingConditions(store: SearchDeps['store'], filters: CandidateFilters) {
  const hasDiet = filters.diet.length > 0
  const hasExclude = filters.excludeCategories.length + filters.excludeTags.length > 0
  const hasIntent = filters.groups.length > 0
  const none: CandidateFilters = { ...filters, diet: [], excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'none', groups: [] }
  const [withDiet, withExclude, withIntent] = await Promise.all([
    hasDiet ? store.count({ ...none, diet: filters.diet }) : null,
    hasExclude ? store.count({ ...none, excludeCategories: filters.excludeCategories, excludeTags: filters.excludeTags }) : null,
    hasIntent ? store.count({ ...none, groups: filters.groups }) : null,
  ])
  const blocks = { diet: withDiet === 0, exclude: withExclude === 0, intent: withIntent === 0 }
  if (blocks.diet || blocks.exclude || blocks.intent) return blocks
  return { diet: hasDiet, exclude: hasExclude, intent: hasIntent }
}

/** Cuántas invitaciones a ampliar se muestran como mucho. */
const WIDEN_MAX = 2

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
  const filters = parseFilters(options.filters)
  const near = parseNear(options.near)
  const intentUrl = parseIntent(options.intent, options.sub)
  const textless = !normalized
  const nameWords = textless ? [] : nameWordsFor(normalized, removedWordsOf(removals))

  // El embedding de la consulta arranca ya: si no hay vibe ni chips quitados es el que se usa. Quitar la
  // intención no cambia el texto.
  const removed = removals.some((removal) => removal.kind !== 'intent')
  const queryEmbedding = removed || textless ? null : deps.cache.embed(normalized).then((result) => priced('embed', result)).catch(() => null)

  // 1. Interpretación: diccionario, nombre fuerte o modelo. Sin texto, sólo los filtros.
  // El atajo del diccionario es sincrónico; la búsqueda por nombre, el modelo y el embedding de la consulta
  // (arriba) arrancan juntos porque no dependen entre sí. Si la consulta resulta ser un nombre fuerte, lo que
  // devolvió el modelo se descarta (queda cacheado por q igual).
  const parallelStart = performance.now()
  const timed = <T,>(name: string, promise: Promise<T>) => promise.finally(() => (timings[name] = elapsed(parallelStart)))
  const dictionary = textless ? null : interpretWithDictionary(normalized)
  const namesPromise = nameWords.length === 0 ? Promise.resolve([] as NameMatch[]) : timed('shortcut', deps.store.nameMatches(normalized).catch(() => [] as NameMatch[]))
  const llmPromise =
    textless || dictionary
      ? null
      : timed(
          'interpret',
          deps.cache.interpret(normalized).then(
            (value) => ({ ok: true as const, value }),
            (error: unknown) => ({ ok: false as const, error }),
          ),
        )
  let nameMatches = await namesPromise
  let pinned = strongNameMatch(nameMatches, normalized, dictionary !== null)

  let source: InterpretationSource
  let original: Interpretation
  let discarded: Discard[] = []
  let model: string | null = null
  let llmError: string | null = null
  if (textless) {
    source = 'filters'
    original = emptyInterpretation()
  } else if (dictionary) {
    source = 'shortcut'
    original = dictionary
  } else if (pinned) {
    source = 'name'
    original = { ...emptyInterpretation(), nameQuery: normalized }
  } else {
    const llm = await llmPromise!
    if (llm.ok) {
      const validation = validateInterpretation(priced('interpret', llm.value).data)
      source = 'llm'
      original = validation.interpretation
      discarded = [
        ...validation.discarded.map((value) => ({ value, reason: 'no está en los catálogos' })),
        ...validation.toPrefer.map((value) => ({ value, reason: 'momento: va como preferencia, nunca como filtro' })),
      ]
      model = llm.value.model
    } else {
      // Sin modelo (timeout o error), la búsqueda sigue sin avisar: lo que el diccionario reconoce como filtros,
      // y el texto tal cual para el embedding, las palabras clave y el nombre.
      source = 'fallback'
      llmError = errorMessage(llm.error)
      costs.push({ step: 'interpret', model: SEARCH_CONFIG.llm.model, usd: null, cached: false })
      const partial = interpretWithDictionary(normalized, { partial: true }) ?? emptyInterpretation()
      original = { ...partial, needsLocation: partial.needsLocation || mentionsNearMe(normalized), wantsBest: partial.wantsBest || mentionsBest(normalized) }
    }
  }
  timings.parallel = elapsed(parallelStart)

  // El modelo puede corregir el nombre ("cardnal" → "cardinal").
  const nameQuery = original.nameQuery ? normalizeQuery(original.nameQuery) : null
  let step = performance.now()
  if (!pinned && nameQuery && nameQuery !== normalized) {
    step = performance.now()
    const corrected = await deps.store.nameMatches(nameQuery).catch(() => [] as NameMatch[])
    pinned = strongNameMatch(corrected, nameQuery, false)
    if (corrected.length) nameMatches = corrected
    timings.nameRetry = elapsed(step)
  }

  // Lo escrito (cacheado por q) menos los chips quitados, con la intención (de la URL o del texto) y la barra
  // de filtros: un solo modelo.
  const fromText = applyRemove(original, removals)
  const resolved = resolveIntent(fromText, intentUrl, removals)
  const interpretation = applyFilters(resolved.interpretation, filters)
  discarded = [...discarded, ...intendedDiscards(original, removals, filters)]
  const must = checkMust(original, interpretation, resolved, discarded)
  reportMust(must, rawQuery)
  if (removals.some((removal) => removal.kind === 'name')) pinned = null

  // 2. Embedding del texto semántico; si falla, se sigue sin el ranking semántico.
  step = performance.now()
  const edits: TextEdits = { removed, removedWords: removedWordsOf(removals), shortcut: source === 'shortcut' }
  const semanticText = textless ? null : semanticTextFor(normalized, interpretation, edits)
  const embedded: EmbeddingResult | null =
    semanticText === null ? null
    : semanticText === normalized && queryEmbedding ? await queryEmbedding
    : await deps.cache.embed(semanticText).then((result) => priced('embed', result)).catch(() => null)
  const embedding = embedded?.embedding ?? null
  timings.embed = elapsed(step)

  const dishes = interpretation.dishes.map(dishTargetFor)
  const keywords = keywordsFor(normalized, interpretation, edits)
  const scores: ScoreInputs = {
    embedding,
    keywords,
    // Un nombre (del modelo o fijado) se busca difuso, con errores de tipeo; si no, sólo las palabras que quedan.
    name: nameQuery ?? (nameWords.length ? nameWords.join(' ') : null),
    // Con cerca mío, la distancia se mide desde la persona y entra al ranking desde el primer intento.
    origins: near ? [near] : [],
    pinnedId: pinned?.id ?? null,
  }

  // De dónde sale cada chip: del texto, de la barra o de los dos (así se sabe cómo apagarlo).
  const textKeys = new Set(buildChips(fromText, today).map((chip) => `${chip.kind}:${chip.id}`))
  const filterKeys = filterChipKeys(filters)
  const chipsOf = (chips: Chip[]) =>
    chips.map((chip) => ({ ...chip, fromText: textKeys.has(`${chip.kind}:${chip.id}`), fromFilter: filterKeys.has(`${chip.kind}:${chip.id}`) }))

  // "Abre hoy" para cenar es a la noche, como "esta noche".
  const openFilterOf = (value: Interpretation) =>
    resolveOpenAt(value.must.openAt, now, { dinner: [...value.must.tags, ...value.prefer.tags].includes('dinner') })

  // 3. Candidatos, relajando de a un paso mientras no haya ninguno.
  const relaxedSteps: RelaxStep[] = []
  const attempts: SearchDebug['attempts'] = []
  const initial: SearchState = {
    interpretation,
    dishMode: 'dish',
    nearRadius: near ? SEARCH_CONFIG.near.radii[0] : null,
    intent: resolved.intent,
    subs: resolved.subs.map((sub) => sub.id),
  }
  let state = initial
  // El "Ver todos" de un grupo exige su regla; como la intención, nunca se relaja.
  const sectionGroups: FilterGroup[] = filters.section ? [sectionDef(filters.section).match] : []
  const filtersOf = (value: SearchState) =>
    filtersFor(
      value.interpretation,
      openFilterOf(value.interpretation),
      dishes,
      value.dishMode,
      near && value.nearRadius !== null ? { ...near, radiusM: value.nearRadius } : null,
      [...intentGroups(value.intent, value.subs), ...sectionGroups],
    )
  const fetchCandidates = async () => {
    const attemptStart = performance.now()
    const result = await deps.store.candidates(filtersOf(state), scores)
    attempts.push({ relaxed: [...relaxedSteps], dishMode: state.dishMode, candidates: result.length, matching: result.filter((row) => row.matchesFilters).length, ms: elapsed(attemptStart) })
    return result
  }
  let rows = await fetchCandidates()
  for (const relaxStep of RELAX_ORDER) {
    if (rows.some((row) => row.matchesFilters) || !canRelax(state, relaxStep, dishes)) continue
    if (relaxStep === 'neighborhood' && !near) {
      scores.origins = state.interpretation.must.neighborhoods.flatMap((id) => (CENTROIDS[id] ? [CENTROIDS[id]] : []))
    }
    state = relax(state, relaxStep)
    relaxedSteps.push(relaxStep)
    rows = await fetchCandidates()
  }
  timings.candidates = attempts.reduce((sum, attempt) => sum + attempt.ms, 0)
  const current = state.interpretation

  // 4. Rankings, fusión, empujones, corte por relevancia y una card por marca. Se repite con widen, para contar
  // cuántos más saldrían sin un filtro.
  const rank = (candidates: CandidateRow[], value: SearchState) => {
    const wanted = value.interpretation
    const openAt = openFilterOf(wanted)
    const relatedTags = value.dishMode === 'related' ? dishes.flatMap((target) => target.related.tags) : dishes.flatMap((target) => (target.tag ? [target.tag] : []))
    const rankings = buildRankings(candidates, { withQuality: textless, wholeWords: nameQuery ? null : nameWords })
    const requestedCategories = [...wanted.must.categories, ...wanted.prefer.categories]
    const requestedTags = [...wanted.must.tags, ...wanted.prefer.tags, ...relatedTags]
    const dancing = ['night_club', 'dancing', 'dj']
    const wantsDancing = [...requestedCategories, ...requestedTags].some((id) => dancing.includes(id)) || intentGroups(value.intent, value.subs).slice(1).some((group) =>
      [...(group.categories ?? []), ...(group.tags ?? [])].some((id) => dancing.includes(id)))
    const allFused = fuse(candidates, rankings, {
      pinnedId: pinned?.id ?? null,
      dishes,
      categories: requestedCategories,
      requestedTags,
      preferTags: wanted.prefer.tags,
      preferStyle: wanted.prefer.style,
      price: wanted.must.price,
      openAt,
      wantsBest: wanted.wantsBest,
      wantsDancing,
      intent: value.intent,
      section: filters.section,
    })
    // Sin tope: se muestran todos los que pasan el corte por relevancia (los de horario sin confirmar, al final).
    const cut = relevanceCut(allFused, {
      hasEmbedding: embedding !== null,
      categories: requestedCategories,
      tags: requestedTags,
      hasDishes: dishes.length > 0,
      // La intención del verbo del texto (no la que sólo pide la URL).
      intent: wanted.intent !== null && wanted.intent === value.intent ? intentGroups(value.intent, [])[0] : null,
    })
    // Una card por marca: las otras sucursales no ocupan lugar en la lista, las secciones ni los avisos.
    const fused = collapseBranches(cut.kept, { neighborhoods: interpretation.must.neighborhoods, near: near !== null })
    return { openAt, rankings, cut, fused }
  }
  step = performance.now()
  const { openAt, rankings, cut, fused } = rank(rows, state)
  timings.fuse = elapsed(step)

  // 5. Respuesta.
  // "Abre hoy" se muestra como ahora: "Abierto · cierra 23:00" o "Abre 20:00".
  const moment = openAt?.moment ?? montevideoNow(now)
  const isNow = openAt === null || openAt.today
  const results = fused.map((item): SearchResult => {
    const open = item.open ?? openStatus(item.row.hours, moment)
    const next = isNow && open.state === 'closed' && moment.time ? nextOpening(item.row.hours, { day: moment.day, time: moment.time }) : null
    return {
      id: item.row.id,
      slug: item.row.slug,
      name: item.row.name,
      neighborhood: neighborhoodDisplayName(item.row.neighborhoodId) ?? item.row.neighborhoodId,
      categories: item.row.categories,
      iconCategory: item.row.iconCategory,
      logoKey: item.row.logoKey,
      logoUrl: logoUrl(item.row.logoKey),
      logoBgColor: item.row.logoBgColor,
      lat: item.row.lat,
      lng: item.row.lng,
      branchCount: item.row.brandCount,
      branches: item.branches.map(({ row }) => ({ id: row.id, lat: row.lat, lng: row.lng })),
      reasons: buildReasons(item, { interpretation: current, dishes, dishMode: state.dishMode, intent: state.intent, near: near !== null }),
      openStatus: {
        state: open.state,
        closesAt: open.state === 'open' ? open.closesAt : null,
        label: openStateLabel(open, interpretation.language, moment, isNow, next),
        ...openStateText(open, interpretation.language, moment, isNow, next),
      },
      matchLevel: item.matchLevel,
    }
  })

  // Secciones: sólo en búsquedas amplias y con suficientes resultados.
  const minResults = SEARCH_CONFIG.sections.minResults
  const notGrouped = notBroadReason(interpretation, { pinned: pinned !== null, subs: resolved.subs.length, section: filters.section !== null }) ??
    (fused.length < minResults ? `menos de ${minResults} resultados` : null)
  const sectionChoice = notGrouped ? null : requestedSections(interpretation, { fromLlm: source === 'llm', intent: state.intent })
  const grouped = sectionChoice ? buildSections(fused, sectionChoice.requested, interpretation.language) : null
  const sectionsDebug: SectionsDebug = {
    notGrouped: notGrouped ?? (grouped?.sections ? null : 'ningún grupo llegó al mínimo'),
    source: sectionChoice?.source ?? null,
    requested: sectionChoice?.requested ?? [],
    chosen: grouped?.chosen ?? [],
    dropped: grouped?.dropped ?? [],
  }

  // Avisos: cada paso se arma con el estado previo y sólo si algún resultado no cumple lo relajado.
  const shownRows = fused.filter((item) => !item.pinned).map((item) => item.row)
  const relaxed: SearchResponse['relaxed'] = []
  let before = initial
  for (const relaxStep of relaxedSteps) {
    const notice = relaxNotice(relaxStep, {
      before,
      after: state,
      rows: shownRows,
      dishes,
      openAt: openFilterOf(before.interpretation),
    })
    if (notice && shownRows.length) relaxed.push(notice)
    before = relax(before, relaxStep)
  }

  // Cero resultados: sólo pueden bloquear la dieta o los exclude, que nunca se relajan.
  let suggestedRemovals: Chip[] = []
  if (shownRows.length === 0) {
    step = performance.now()
    const blocking = await blockingConditions(deps.store, filtersOf(state))
    const chips = chipsOf(buildChips(interpretation, today))
    suggestedRemovals = chips.filter((chip) => (blocking.diet && chip.kind === 'diet') || (blocking.exclude && chip.kind === 'exclude'))
    relaxed.push(noMatchNotice(interpretation, blocking, state.intent))
    timings.diagnose = elapsed(step)
  }
  timings.total = elapsed(started)

  // Extras de la barra: lo que pidió el texto y no quedó representado por la intención ni sus sub-filtros. Los
  // momentos y el style son preferencias, pero se muestran igual para poder quitarlos.
  const chips = chipsOf(buildChips(interpretation, today, near !== null))
  const subKeys = new Set(resolved.subs.flatMap((sub) => sub.removeKeys))
  const shownPreference = (chip: Chip) => chip.kind === 'prefer' && (isOccasionTag(chip.id) || isStyleId(chip.id)) && !subKeys.has(`prefer:${chip.id}`)
  const extras = chips.filter(
    (chip) => chip.fromText && (chip.kind === 'category' || chip.kind === 'tag' || shownPreference(chip) || (chip.kind === 'dish' && !resolved.absorbedDishes.includes(chip.id))),
  )
  // El "Ver todos" de un grupo se ve activo en la barra y se apaga sacándolo de f.
  if (filters.section) {
    extras.push({ kind: 'section', id: filters.section, label: sectionDef(filters.section).title[interpretation.language], fromText: false, fromFilter: true })
  }
  const bar = buildBar(resolved, extras)

  // Invitación a ampliar: cuántos lugares más saldrían sin cada filtro que sigue activo después de relajar (barrio,
  // horario, cada dieta, cada sub-filtro). Reusa la interpretación y el embedding: sólo SQL, un pedido por filtro.
  const widenOptions = async (): Promise<WidenOption[]> => {
    if (shownRows.length === 0) return []
    const value = state.interpretation
    const withMust = (must: Partial<Interpretation['must']>): SearchState => ({ ...state, interpretation: { ...value, must: { ...value.must, ...must } } })
    const chipOption = (chip: Chip | undefined, kind: WidenOption['kind'], next: SearchState) =>
      chip ? [{ option: { kind, id: chip.id, label: chip.label, fromText: chip.fromText ?? false, fromFilter: chip.fromFilter ?? false }, state: next }] : []
    const removable = [
      ...(value.must.neighborhoods.length
        ? chipOption(chips.find((chip) => chip.kind === 'neighborhood' && value.must.neighborhoods.includes(chip.id)), 'neighborhood', withMust({ neighborhoods: [] }))
        : []),
      ...(value.must.openAt ? chipOption(chips.find((chip) => chip.kind === 'openAt'), 'openAt', withMust({ openAt: null })) : []),
      ...DIET_KEYS.filter((key) => value.must.diet[key]).flatMap((key) =>
        chipOption(chips.find((chip) => chip.kind === 'diet' && chip.id === key), 'diet', withMust({ diet: { ...value.must.diet, [key]: false } }))),
      ...state.subs.flatMap((id) => {
        const sub = bar.subs.find((entry) => entry.id === id)
        if (!sub) return []
        return [{ option: { kind: 'sub' as const, id, label: sub.label, fromText: sub.fromText, fromFilter: false }, state: { ...state, subs: state.subs.filter((other) => other !== id) } }]
      }),
    ]
    const shownIds = new Set(fused.flatMap((item) => [item.row.id, ...item.branches.map((branch) => branch.row.id)]))
    const counted = await Promise.all(
      removable.map(async ({ option, state: next }) => {
        const wider = rank(await deps.store.candidates(filtersOf(next), scores), next).fused
        return { ...option, count: wider.filter((item) => !shownIds.has(item.row.id)).length }
      }),
    )
    return counted.filter((option) => option.count > 0).sort((a, b) => b.count - a.count).slice(0, WIDEN_MAX)
  }
  const response: SearchResponse = {
    query: rawQuery,
    interpreted: { chips },
    bar,
    results,
    sections: grouped?.sections ?? null,
    relaxed,
    suggestedRemovals,
    needsLocation: interpretation.needsLocation,
    near,
  }
  if (options.widen) {
    step = performance.now()
    response.widen = await widenOptions()
    timings.widen = elapsed(step)
  }

  if (options.debug) {
    // El embedding de la consulta se pagó aunque al final se usara el de la vibe, y el modelo aunque la
    // consulta resultara ser un nombre.
    await queryEmbedding
    if (llmPromise && (source === 'name' || source === 'shortcut')) {
      const llm = await llmPromise
      if (llm.ok) costs.push({ step: 'interpret', model: llm.value.model, usd: llm.value.cost, cached: llm.value.computedAt < startedAt, discarded: true })
    }
    const depth = SEARCH_CONFIG.debugDepth
    const collapsedInto = new Map(fused.flatMap((item) => item.branches.map((branch) => [branch.row.id, item.row.id] as const)))
    response.debug = {
      source,
      model,
      llmError,
      discarded,
      must,
      intentVotes: resolved.votes,
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
        quality: rankings.quality.slice(0, depth),
      },
      results: [...cut.kept, ...cut.cut].map((item) => ({
        id: item.row.id,
        name: item.row.name,
        categories: item.row.categories,
        tags: item.row.tags,
        diet: item.row.diet,
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
        similarity: item.row.semantic,
        relevance: cut.relevance.get(item.row.id)!,
        brandKey: item.row.brandKey,
        collapsedInto: collapsedInto.get(item.row.id) ?? null,
      })),
      relevance: cut.summary,
      timings,
      cost: summarizeCost(costs),
      sections: sectionsDebug,
    }
  }
  return response
}
