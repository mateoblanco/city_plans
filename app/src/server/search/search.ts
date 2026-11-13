import { findDef, hasPartialTags, isOccasionTag, isStyleId, label, normalize, withPartialTags, withSubcuisines } from '@shared/tags.ts'
import { neighborhoodDisplayName, neighborhoodNameForms } from '@shared/neighborhood-names.ts'
import { sectionDef } from '@shared/sections.ts'
import { INTENT_VERB_WORDS } from '@shared/intents.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import { SEARCH_CONFIG } from './config'
import type { CacheSource, EmbeddingResult, SearchCache } from './cache'
import type { CandidateFilters, CandidateRow, DishMode, FilterGroup, NameMatch, ScoreInputs } from './candidates'
import { summarizeCost, type CostEntry, type SearchCost } from './cost'
import { collapseBranches, type Collapsed } from './branches'
import { requestedCuisines } from './cuisines'
import { buildChips, type Chip } from './chips'
import { applyDictionary, interpretWithDictionary, mentionsParents, NEGATIONS } from './dictionary'
import { applyWhen, TIME_WORDS } from './when'
import { checkMust, intendedDiscards, reportMust, type Discard, type MustCheck } from './invariant'
import { dishTargetFor, excludedIcons, preferredDiets, type DishTarget } from './dishes'
import { applyFilters, filterChipKeys, parseFilters, type LatLng } from './filters'
import { buildBar, intentGroups, parseIntent, resolveIntent, type IntentBar } from './intents'
import { buildRankings, fuse, rareTagsOf, subPartialTags, type Fused, type MatchLevel, type Rankings } from './fuse'
import { keywordFilter } from './keywords'
import { singularForms } from './dishes'
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
import { DISPLAY_LANG, distanceLabel, openStateLabel, openStateText, type OpenStateText } from './labels'
import { EMPTY_ZONE_NOTICE, OUTSIDE_NOTICE, parseLocationChoice, parseLocationCookie, radiusNotice, resolveLocation, zoneOrigin, type SearchLocation } from './location'
import { normalizeQuery, queryWords } from './normalize'
import { buildReasons } from './reasons'
import { logoUrl } from './logo'
import { relevanceCut, type Relevance } from './relevance'
import { buildSections, notBroadReason, requestedSections, sectionPartialTags, type Section, type SectionsDebug } from './sections'
import { discountSections } from '../discounts/sections'
import { cardProviders, type PlaceDiscount } from '../discounts/selection'
import { momentsOf } from './moments'
import { emptyPersonalDebug, personalize, type PersonalDebug } from './personal'
import { canRelax, NEARBY_STEPS, noMatchNotice, relax, RELAX_ORDER, relaxNotice, type NoticeKind, type RelaxStep, type SearchState } from './relax'
import { emptyNeighborhoodNotice, nearbyFilterFor, nearbyLabel, nearbyTitle, orderNearby } from './nearby'
import type { PlacesStore } from './store'
import { applyVenues, type Venue } from './venues'

export type SearchDeps = { store: PlacesStore; cache: SearchCache }
/**
 * filters: `f` de la URL (barra de filtros); loc: `loc` de la URL (near, all o una zona; location.ts); near: el
 * `near=lat,lng` viejo, que cuenta como `loc=near` (su coordenada se ignora); userLocation: la cookie `loc` (la
 * ubicación de la persona, redondeada, `denied` o `skip`); intent / sub: intención y sub-filtros.
 */
export type SearchOptions = {
  remove?: string | null
  filters?: string | null
  loc?: string | null
  near?: string | null
  userLocation?: string | null
  /**
   * Sin `loc` ni barrio, cerca mío (o pedir la ubicación: `location.kind = 'ask'`). Sólo /search y /api/search; la home,
   * los scripts y lo demás buscan en todo Montevideo.
   */
  defaultNear?: boolean
  intent?: string | null
  sub?: string | null
  debug?: boolean
  /** Contar cuántos lugares más saldrían sin cada filtro activo (la invitación a ampliar del final de la lista). */
  widen?: boolean
  /** Ids de los lugares que te gustaron (cookie espejo de localStorage): se usan en este pedido y no se guardan. */
  likes?: string[]
  /** false (`profile=off`): la misma búsqueda sin perfil, igual que sin likes. */
  profile?: boolean
  /** "Para vos" de la home: sin grupos, con el perfil con más likes y de 4 a 8 lugares (SEARCH_CONFIG.personal.home). */
  home?: boolean
  now?: Date
}

/**
 * Invitación a ampliar: sacar este filtro suma count lugares. kind sub es un sub-filtro de la intención; el resto,
 * chips (fromText / fromFilter dicen cómo apagarlo).
 */
export type WidenOption = { kind: 'neighborhood' | 'venue' | 'openAt' | 'diet' | 'sub'; id: string; label: string; fromText: boolean; fromFilter: boolean; count: number }

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
  /** Lugar que contiene al local, para "Dentro de …"; null si no. */
  locatedIn: string | null
  lat: number
  lng: number
  /** Sucursales publicadas de la marca (1 sin marca), para "N sucursales". */
  branchCount: number
  /** Las otras sucursales de la marca que salieron en la búsqueda: no tienen card, sí punto en el mapa. */
  branches: { id: string; lat: number; lng: number }[]
  reasons: string[]
  /** Proveedores de descuento para los chips de "Descuento" en la card (en el orden de la config); con el filtro, sólo los elegidos. */
  discounts: { id: string; name: string }[]
  openStatus: { state: OpenState['state']; closesAt: string | null; label: string } & OpenStateText
  matchLevel: MatchLevel
  /** Con cerca mío: "a 400 m", "a 1,2 km" (la card lo suma a la línea de barrio y categoría); null en otra búsqueda. */
  distance: string | null
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
  /**
   * Cada intento de candidatos. Con barrio, la consulta de "Cerca de" va en paralelo (nearby); ms es lo que tardó el
   * intento entero (la más lenta de las dos).
   */
  attempts: {
    relaxed: RelaxStep[]
    dishMode: DishMode
    candidates: number
    matching: number
    ms: number
    nearby?: { candidates: number; matching: number; ms: number }
    /** Cerca mío: el radio de este intento (los del principio corren en paralelo, uno por radio). */
    radiusM?: number
  }[]
  /** Cerca mío: cuántos "has" dio cada radio y cuál se usó; null sin cerca mío. */
  near: { tried: { radiusM: number; has: number }[]; chosen: number } | null
  /** "Buscar en esta zona": se ordenó desde la persona o desde el centro de la zona; null sin zona. */
  zoneOrigin: 'user' | 'center' | null
  rankings: Rankings
  results: {
    id: string
    name: string
    /** Datos del lugar para verificar resultados (search:check). */
    categories: string[]
    tags: string[]
    diet: CandidateRow['diet']
    price: string
    iconCategory: CandidateRow['iconCategory']
    style: CandidateRow['style']
    neighborhoodId: string
    locatedIn: string | null
    /** Proveedor y tipo de tarjeta de cada beneficio que cuenta (search:check). */
    discounts: PlaceDiscount[]
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
    /** Metros al borde del barrio pedido: sólo los de "Cerca de" (también en su "Ver todos"). */
    edgeDistance: number | null
    /** Metros desde la persona (cerca mío) o desde el venue relajado; null sin origen. */
    distance: number | null
  }[]
  /** Los de "Cerca de <barrio>" en su orden (todos, no sólo los del grupo); vacío sin grupo o en su "Ver todos". */
  nearby: SearchDebug['results']
  /** Corte por relevancia: la similitud más alta y desde dónde se corta; null si no hubo embedding. */
  relevance: { best: number; threshold: number; gap: number } | null
  timings: Record<string, number>
  /** Lo que costó esta búsqueda en el AI Gateway (lo que vino de la cache cuenta 0). */
  cost: SearchCost
  /** Si se agrupó: de dónde salieron los grupos, los elegidos y los descartados por chicos; si no, por qué no. */
  sections: SectionsDebug
  /** Likes usados, el lugar de "Parecido a" y el parecido de cada lugar de los bloques personales. */
  personal: PersonalDebug
  /** Relleno de brunch: los "has" con el tag y cuántos cafés de desayuno y almuerzo se agregaron; null si no aplicó. */
  brunchFill: { has: number; added: number } | null
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
  /**
   * Búsqueda sin grupos (y no por nombre) con perfil: la fila "Para vos" (3–4 ids de results, que la lista de abajo no
   * repite). results no cambia. null: sin fila.
   */
  forYou: Section | null
  relaxed: { what: NoticeKind; message: string }[]
  /** Con cero resultados: los chips de dieta o exclude que hay que sacar para que aparezcan lugares. */
  suggestedRemovals: Chip[]
  /** Dónde se buscó (lo que muestra el filtro "Dónde"); ask: hay que pedir la ubicación y no hay resultados. */
  location: SearchLocation
  /** Ubicación con la que se buscó (ya redondeada), para el punto del mapa; sólo con cerca mío. */
  near: LatLng | null
  /**
   * "Cerca de <barrio>": con un barrio pedido, los lugares de otros barrios a menos de SEARCH_CONFIG.nearby.radiusM del
   * borde, con los mismos filtros. results son los del grupo (hasta nearby.maxPlaces) y total, todos (el contador y "Ver
   * todos"). label: el barrio ("Palermo", "Palermo y Cordón"). null: sin barrio o sin ninguno cerca.
   */
  nearby: { title: string; label: string; total: number; results: SearchResult[] } | null
  /** El "Ver todos" de "Cerca de" (`f=nearby:1`): results son todos los cercanos. null en cualquier otra búsqueda. */
  nearbyOnly: { title: string; label: string } | null
  /** Sólo con la opción widen: hasta WIDEN_MAX filtros para sacar, de los que más suman a los que menos (count > 0). */
  widen?: WidenOption[]
  debug?: SearchDebug
}

const STOPWORDS = new Set([
  'en', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'uno', 'unos', 'unas', 'y', 'o', 'con', 'para', 'por', 'a', 'al', 'que', 'algo', 'lugar', 'no', 'sea', 'mejor', 'mejores', 'top', 'mis',
  // Palabras que no describen nada ("comida peruana", "un lugar para…"): ni keyword ni nombre (Panza Comida Casera).
  'comida', 'comidas', 'lugares', 'sitio', 'sitios', 'local', 'locales', 'opcion', 'opciones',
  'in', 'at', 'near', 'the', 'an', 'with', 'for', 'and', 'or', 'of', 'to', 'best', 'place', 'places', 'spot', 'food', 'something', 'somewhere', 'me',
])

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
      if (kind === 'neighborhood') return neighborhoodNameForms(id).flatMap((name) => queryWords(normalize(name)))
      if (kind === 'venue') return queryWords(normalize(id))
      return []
    }),
  )
}

export function keywordsFor(normalized: string, value: Interpretation, edits: TextEdits): string[] {
  const excluded = new Set([...value.exclude.categories, ...value.exclude.tags].flatMap(termWords))
  // Con el atajo, la consulta es lo que pidió la persona (menos lo quitado); con el modelo y chips quitados, sólo los platos.
  const fromQuery = edits.removed && !edits.shortcut ? [] : queryWords(normalized).filter((word) => !edits.removedWords.has(word))
  const words = [...value.dishes.flatMap((dish) => queryWords(normalize(dish.name))), ...fromQuery]
  // El verbo que eligió la intención ("tomar algo") ya hizo su trabajo: como keyword empata a casi todos. Las
  // palabras de horario ("tarde", "martes") ya están en openAt.
  const verb = (word: string) => value.intent !== null && INTENT_VERB_WORDS.has(word)
  // Las negaciones ("sin carne") tampoco: "sin" empataba con todo lo "sin TACC" o "sin alcohol".
  return [...new Set(words)].filter((word) => word.length > 1 && !STOPWORDS.has(word) && !NEGATIONS.has(word) && !excluded.has(word) && !verb(word) && !TIME_WORDS.has(word))
}

/**
 * Palabras para buscar por nombre: la consulta sin palabras vacías, sin negaciones ("sin carne" no es Sin Berretines),
 * sin los verbos de intención ("comer algo" → nada), sin las de horario ("tarde", "martes") y sin las de los chips
 * quitados. Sin ninguna, la búsqueda por nombre no corre.
 */
export function nameWordsFor(normalized: string, removedWords: Set<string>): string[] {
  return [...new Set(queryWords(normalized))].filter((word) =>
    !STOPWORDS.has(word) && !NEGATIONS.has(word) && !INTENT_VERB_WORDS.has(word) && !TIME_WORDS.has(word) && !removedWords.has(word))
}

const GENERIC_NAME_WORDS = new Set<string>(SEARCH_CONFIG.name.genericWords)
const isGenericNameWord = (word: string) => singularForms(word).some((form) => GENERIC_NAME_WORDS.has(form))

/**
 * Las palabras que tiene que tener entero un nombre para contar en el ranking de nombre: sin las genéricas ("café", "bar")
 * y sin las del barrio pedido ("milanesa en pocitos" sigue empujando a El Club de la Milanesa).
 */
export function distinctiveNameWords(words: string[], neighborhoods: string[]): string[] {
  const place = new Set(neighborhoods.flatMap((id) => neighborhoodNameForms(id).flatMap((name) => queryWords(normalize(name)))))
  return words.filter((word) => !isGenericNameWord(word) && !place.has(word))
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
    ...value.must.venues,
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
  venues: Venue[] = [],
  discounts: CandidateFilters['discounts'] = [],
): CandidateFilters {
  return {
    categories: value.must.categories,
    tags: value.must.tags,
    diet: DIET_KEYS.filter((key) => value.must.diet[key]),
    neighborhoods: value.must.neighborhoods,
    venues: venues.filter((venue) => value.must.venues.includes(venue.name)),
    price: value.must.price,
    openAt,
    excludeCategories: value.exclude.categories,
    excludeTags: value.exclude.tags,
    excludeIcons: excludedIcons(value.exclude.tags),
    dishes,
    dishMode,
    near,
    groups,
    discounts,
  }
}

/**
 * Lugar que va primero por nombre. Con la consulta resuelta por el diccionario hace falta casi el nombre exacto. Las
 * palabras genéricas solas ("café", "el bar") nunca fijan un lugar.
 */
export function strongNameMatch(matches: NameMatch[], query: string, structured: boolean): NameMatch | null {
  const { name } = SEARCH_CONFIG
  if (query.length < name.minStrongLength) return null
  const words = queryWords(query).filter((word) => !STOPWORDS.has(word))
  if (words.length > 0 && words.every(isGenericNameWord)) return null
  const best = matches[0]
  if (!best) return null
  if (structured) return best.similarity >= name.strongSimilarityWhenStructured ? best : null
  return best.similarity >= name.strongSimilarity || best.wordSimilarity >= name.strongWordSimilarity ? best : null
}

/**
 * Qué impide encontrar lugares cuando ya se relajó todo: la dieta, los exclude, la intención o la combinación.
 * Se marcan los que dan cero por separado; si ninguno da cero, es la combinación y se marcan la dieta y los exclude
 * pedidos. Sin dieta ni exclude, nada bloquea: published dice si hay algún lugar publicado.
 */
async function blockingConditions(store: SearchDeps['store'], filters: CandidateFilters) {
  const hasDiet = filters.diet.length > 0
  const hasExclude = filters.excludeCategories.length + filters.excludeTags.length + filters.excludeIcons.length > 0
  const hasIntent = filters.groups.length > 0
  // Sin la zona del mapa: lo que se diagnostica es la dieta, los exclude o la intención, no el área elegida.
  const none: CandidateFilters = { ...filters, diet: [], excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'none', groups: [], zone: null }
  const [withDiet, withExclude, withIntent] = await Promise.all([
    hasDiet ? store.count({ ...none, diet: filters.diet }) : null,
    hasExclude ? store.count({ ...none, excludeCategories: filters.excludeCategories, excludeTags: filters.excludeTags, excludeIcons: filters.excludeIcons }) : null,
    hasIntent ? store.count({ ...none, groups: filters.groups }) : null,
  ])
  const blocks = { diet: withDiet === 0, exclude: withExclude === 0, intent: withIntent === 0 }
  if (blocks.diet || blocks.exclude || blocks.intent) return blocks
  if (hasDiet || hasExclude) return { diet: hasDiet, exclude: hasExclude, intent: hasIntent }
  // Nada bloquea por sí solo: ¿hay algún lugar publicado?
  const published = await store.count({ ...none, categories: [], tags: [], neighborhoods: [], venues: [], price: [], openAt: null, near: null })
  return { diet: false, exclude: false, intent: false, published }
}

/** Cuántas invitaciones a ampliar se muestran como mucho. */
const WIDEN_MAX = 2

/**
 * Con capas de cache, lo dice la capa (otra búsqueda simultánea puede haber hecho la llamada después de que arrancó
 * esta); sin ellas, un computedAt anterior a la búsqueda.
 */
const wasCached = (result: { computedAt: number; cacheSource?: CacheSource }, startedAt: number) =>
  result.cacheSource ? result.cacheSource !== 'none' : result.computedAt < startedAt
const elapsed = (start: number) => Math.round(performance.now() - start)
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function runSearch(rawQuery: string, deps: SearchDeps, options: SearchOptions = {}): Promise<SearchResponse> {
  const started = performance.now()
  const startedAt = Date.now()
  const costs: CostEntry[] = []
  const priced = <T extends { model: string; cost: number | null; computedAt: number; cacheSource?: CacheSource }>(step: CostEntry['step'], result: T) => {
    costs.push({ step, model: result.model, usd: result.cost, cached: wasCached(result, startedAt), ...(result.cacheSource && { source: result.cacheSource }) })
    return result
  }
  const timings: Record<string, number> = {}
  const now = options.now ?? new Date()
  const today = montevideoNow(now).day
  const normalized = normalizeQuery(rawQuery)
  const removals = parseRemove(options.remove)
  const filters = parseFilters(options.filters)
  const locationChoice = parseLocationChoice(options.loc, options.near)
  const userLocation = parseLocationCookie(options.userLocation)
  const intentUrl = parseIntent(options.intent, options.sub)
  const textless = !normalized
  const nameWords = textless ? [] : nameWordsFor(normalized, removedWordsOf(removals))

  // El embedding de la consulta arranca ya: si no hay vibe ni chips quitados es el que se usa. Quitar la
  // intención no cambia el texto.
  const removed = removals.some((removal) => removal.kind !== 'intent')
  const queryEmbedding = removed || textless ? null : deps.cache.embed(normalized).then((result) => priced('embed', result)).catch(() => null)
  // Los venues (located_in) para reconocerlos en el texto; sin ellos, la búsqueda sigue igual.
  const venuesPromise = textless ? Promise.resolve([] as Venue[]) : deps.store.venues().catch(() => [] as Venue[])

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
      const validation = validateInterpretation(priced('interpret', llm.value).data, normalized)
      source = 'llm'
      // El horario escrito manda sobre el del modelo ("tomar algo tarde" es trasnoche, no 21:00), y las frases del
      // diccionario ("cerca de la rambla") se suman a lo que entendió.
      original = applyDictionary(applyWhen(validation.interpretation, normalized), normalized)
      discarded = [
        ...validation.discarded.map((value) => ({ value, reason: 'no está en los catálogos' })),
        ...validation.notNamed.map((value) => ({ value, reason: 'el texto no nombra el barrio: va como no reconocido' })),
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
  // Un venue nombrado ("en el Mercado del Puerto") filtra por sus locales y los de alrededor. El atajo nunca lo tiene
  // (sus palabras no son del diccionario) y un nombre fijado no filtra.
  const venues = await venuesPromise
  if (source === 'llm' || source === 'fallback') {
    const venued = applyVenues(original, normalized, venues)
    original = venued.interpretation
    discarded = [...discarded, ...venued.discarded]
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

  // Dónde: el barrio (barra o texto) gana; después la zona, lo elegido en `loc` y, sin nada, cerca mío o pedir la ubicación.
  const location = resolveLocation({
    choice: locationChoice,
    user: userLocation,
    defaultNear: options.defaultNear ?? false,
    neighborhoods: interpretation.must.neighborhoods,
    venues: interpretation.must.venues,
    pinned: pinned !== null,
    textNear: interpretation.needsLocation,
  })
  const origin = location.kind === 'near' ? location.origin : null
  const zone = location.kind === 'zone' ? location.bounds : null
  // Desde dónde se mide la distancia para ordenar: cerca mío, o la zona desde la persona (si está en ella o cerca) o
  // desde su centro. Sin radio en la zona: sólo ordena. La distancia se muestra sólo si es desde la persona.
  const zoneFrom = zone ? zoneOrigin(zone, userLocation) : null
  const rankOrigin = origin ?? zoneFrom?.point ?? null
  const fromUser = origin !== null || zoneFrom?.user === true

  // De dónde sale cada chip: del texto, de la barra o de los dos (así se sabe cómo apagarlo).
  const textKeys = new Set(buildChips(fromText, today).map((chip) => `${chip.kind}:${chip.id}`))
  const filterKeys = filterChipKeys(filters)
  const chipsOf = (chips: Chip[]) =>
    chips.map((chip) => ({ ...chip, fromText: textKeys.has(`${chip.kind}:${chip.id}`), fromFilter: filterKeys.has(`${chip.kind}:${chip.id}`) }))
  // "Cerca de <barrio>": con un barrio pedido (nunca se relaja) y sin un lugar fijado por nombre (ver abajo).
  const nearbyFilter = pinned ? null : nearbyFilterFor(interpretation.must.neighborhoods)
  const nearbyView = filters.nearby && nearbyFilter !== null
  const wanted = interpretation.must.neighborhoods
  // Extras de la barra: lo que pidió el texto y no quedó representado por la intención ni sus sub-filtros. Los
  // momentos y el style son preferencias, pero se muestran igual para poder quitarlos.
  const barOf = (chips: Chip[]) => {
    const subKeys = new Set(resolved.subs.flatMap((sub) => sub.removeKeys))
    const shownPreference = (chip: Chip) => chip.kind === 'prefer' && (isOccasionTag(chip.id) || isStyleId(chip.id)) && !subKeys.has(`prefer:${chip.id}`)
    // Un tag de f (las filas de la home: `tag:afternoon_snack`) también se ve y se apaga como extra.
    const extras = chips.filter(
      (chip) =>
        (chip.fromText && (chip.kind === 'category' || chip.kind === 'tag' || chip.kind === 'venue' || shownPreference(chip) || (chip.kind === 'dish' && !resolved.absorbedDishes.includes(chip.id)))) ||
        (chip.kind === 'tag' && chip.fromFilter),
    )
    // El "Ver todos" de un grupo se ve activo en la barra y se apaga sacándolo de f.
    if (filters.section) {
      extras.push({ kind: 'section', id: filters.section, label: sectionDef(filters.section).title[DISPLAY_LANG], fromText: false, fromFilter: true })
    }
    // El "Ver todos" de "Cerca de" también.
    if (nearbyView) extras.push({ kind: 'nearby', id: '1', label: nearbyTitle(wanted), fromText: false, fromFilter: true })
    return buildBar(resolved, extras)
  }

  // Sin ubicación todavía: no se buscan candidatos (no se muestra todo Montevideo mientras se espera). El cliente pide
  // el permiso, guarda la cookie y vuelve a pedir la misma URL: la interpretación y el embedding ya están en la cache.
  if (location.kind === 'ask') {
    const chips = chipsOf(buildChips(interpretation, today))
    timings.total = elapsed(started)
    return {
      query: rawQuery,
      interpreted: { chips },
      bar: barOf(chips),
      results: [],
      sections: null,
      forYou: null,
      nearby: null,
      nearbyOnly: null,
      relaxed: [],
      suggestedRemovals: [],
      location,
      near: null,
      ...(options.widen && { widen: [] }),
    }
  }

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
    keywordFilter: keywordFilter(keywords, normalized),
    // Un nombre (del modelo o fijado) se busca difuso, con errores de tipeo; si no, sólo las palabras que quedan.
    name: nameQuery ?? (nameWords.length ? nameWords.join(' ') : null),
    // Con cerca mío, la distancia se mide desde la persona y entra al ranking desde el primer intento.
    origins: rankOrigin ? [rankOrigin] : [],
    pinnedId: pinned?.id ?? null,
  }

  // "Abre hoy" para cenar es a la noche, como "esta noche".
  const openFilterOf = (value: Interpretation) =>
    resolveOpenAt(value.must.openAt, now, { dinner: [...value.must.tags, ...value.prefer.tags].includes('dinner') })

  // Rankings, fusión, empujones, corte por relevancia y una card por marca (paso 4). Se repite con widen, para contar
  // cuántos más saldrían sin un filtro, y con cerca mío, para elegir el radio.
  const rank = (candidates: CandidateRow[], value: SearchState) => {
    const wanted = value.interpretation
    const openAt = openFilterOf(wanted)
    const relatedTags = value.dishMode === 'related' ? dishes.flatMap((target) => target.related.tags) : dishes.flatMap((target) => (target.tag ? [target.tag] : []))
    const rankings = buildRankings(candidates, { withQuality: textless, wholeWords: nameQuery ? null : distinctiveNameWords(nameWords, interpretation.must.neighborhoods) })
    const requestedCategories = [...wanted.must.categories, ...wanted.prefer.categories]
    // Una cocina paraguas cuenta con sus hijas: un japonés con japanese en signature es asiático.
    const requestedTags = [...new Set([...wanted.must.tags, ...wanted.prefer.tags, ...relatedTags].flatMap(withSubcuisines))]
    const allFused = fuse(candidates, rankings, {
      pinnedId: pinned?.id ?? null,
      nearDecay: rankOrigin !== null,
      dishes,
      categories: requestedCategories,
      requestedTags,
      preferTags: wanted.prefer.tags,
      rareTags: rareTagsOf(candidates, wanted.prefer.tags),
      moments: momentsOf(wanted.prefer.tags),
      cuisines: requestedCuisines([...wanted.must.tags, ...wanted.prefer.tags]),
      preferStyle: wanted.prefer.style,
      diet: DIET_KEYS.filter((key) => wanted.must.diet[key]),
      preferDiet: preferredDiets(wanted.exclude.tags).filter((key) => !wanted.must.diet[key]),
      price: wanted.must.price,
      openAt,
      wantsBest: wanted.wantsBest,
      avoidNight: mentionsParents(normalized),
      intent: value.intent,
      subs: value.subs,
      section: filters.section,
      // Exigidos con parecidos: del texto, del "Ver todos" de la sección o de un sub-filtro (Al aire libre).
      partialTags: [...new Set([
        ...wanted.must.tags.filter(hasPartialTags),
        ...(filters.section ? sectionPartialTags(filters.section) : []),
        ...subPartialTags(value.intent, value.subs),
      ])],
    })
    // Sin tope: se muestran todos los que pasan el corte por relevancia (los de horario sin confirmar, al final).
    const cut = relevanceCut(allFused, {
      hasEmbedding: embedding !== null,
      categories: requestedCategories,
      // Una terraza pasa el corte con "al aire libre" pedido: el filtro la acepta (PARTIAL_TAGS).
      tags: [...new Set(requestedTags.flatMap(withPartialTags))],
      moments: momentsOf(wanted.prefer.tags),
      hasDishes: dishes.length > 0,
      // La intención del verbo del texto (no la que sólo pide la URL).
      intent: wanted.intent !== null && wanted.intent === value.intent ? intentGroups(value.intent, [])[0] : null,
      venue: wanted.must.venues.length > 0,
    })
    // Una card por marca: las otras sucursales no ocupan lugar en la lista, las secciones ni los avisos.
    const fused = collapseBranches(cut.kept, { neighborhoods: interpretation.must.neighborhoods, near: rankOrigin !== null })
    return { openAt, rankings, cut, fused }
  }

  // 3. Candidatos, relajando de a un paso mientras no haya ninguno.
  const relaxedSteps: RelaxStep[] = []
  const attempts: SearchDebug['attempts'] = []
  const initial: SearchState = {
    interpretation,
    dishMode: 'dish',
    nearRadius: origin ? SEARCH_CONFIG.near.radii[0] : null,
    intent: resolved.intent,
    subs: resolved.subs.map((sub) => sub.id),
  }
  let state = initial
  // El "Ver todos" de un grupo exige su regla; como la intención, nunca se relaja.
  const sectionGroups: FilterGroup[] = filters.section ? [sectionDef(filters.section).match] : []
  const filtersOf = (value: SearchState): CandidateFilters => ({
    ...filtersFor(
      value.interpretation,
      openFilterOf(value.interpretation),
      dishes,
      value.dishMode,
      origin && value.nearRadius !== null ? { ...origin, radiusM: value.nearRadius } : null,
      [...intentGroups(value.intent, value.subs), ...sectionGroups],
      venues,
      // Como la sección, viene de la barra y nunca se relaja.
      filters.discounts,
    ),
    // La zona del mapa, como el barrio, nunca se relaja.
    zone,
  })
  // "Cerca de <barrio>" (nearbyFilter): los de otros barrios a menos de 500 m del borde, con los mismos filtros (los de
  // este intento, ya relajados) y en paralelo con el barrio. Con `nearby:1` (su "Ver todos") son los resultados; el
  // barrio se consulta igual porque decide qué se relaja.
  const matchingOf = (list: CandidateRow[]) => list.filter((row) => row.matchesFilters).length
  const fetchCandidates = async () => {
    const attemptStart = performance.now()
    const timedQuery = async (query: Promise<CandidateRow[]>) => {
      const result = await query
      return { result, ms: elapsed(attemptStart) }
    }
    const [main, close] = await Promise.all([
      timedQuery(deps.store.candidates(filtersOf(state), scores)),
      nearbyFilter ? timedQuery(deps.store.candidates({ ...filtersOf(state), neighborhoods: [], nearby: nearbyFilter }, { ...scores, pinnedId: null })) : null,
    ])
    attempts.push({
      relaxed: [...relaxedSteps],
      dishMode: state.dishMode,
      candidates: main.result.length,
      matching: matchingOf(main.result),
      ms: elapsed(attemptStart),
      ...(close && { nearby: { candidates: close.result.length, matching: matchingOf(close.result), ms: close.ms } }),
    })
    return { rows: main.result, nearbyRows: close?.result ?? [] }
  }
  // Cerca mío: los radios en paralelo (mismo tiempo que uno); se usa el primero con suficientes "has" o, si ninguno llega,
  // el más chico que ya da tantos como el más grande (agrandar más no suma nada). La relajación de siempre sigue sobre
  // ese radio.
  let nearDebug: SearchDebug['near'] = null
  const chooseRadius = async () => {
    const radiusStart = performance.now()
    const tried = await Promise.all(
      SEARCH_CONFIG.near.radii.map(async (radiusM) => {
        const value: SearchState = { ...state, nearRadius: radiusM }
        const result = await deps.store.candidates(filtersOf(value), scores)
        return { radiusM, value, result, ms: elapsed(radiusStart) }
      }),
    )
    const has = tried.map((entry) => rank(entry.result, entry.value).fused.filter((item) => item.matchLevel === 'has').length)
    const enough = has.findIndex((count) => count >= SEARCH_CONFIG.near.minResults)
    const chosen = tried[enough !== -1 ? enough : has.indexOf(Math.max(...has))]
    for (const entry of tried) {
      attempts.push({ relaxed: [], dishMode: state.dishMode, candidates: entry.result.length, matching: matchingOf(entry.result), ms: entry.ms, radiusM: entry.radiusM })
    }
    nearDebug = { tried: tried.map((entry, position) => ({ radiusM: entry.radiusM, has: has[position] })), chosen: chosen.radiusM }
    state = chosen.value
    return chosen.result
  }
  let { rows, nearbyRows } = origin ? { rows: await chooseRadius(), nearbyRows: [] as CandidateRow[] } : await fetchCandidates()
  const chosenRadius = state.nearRadius
  for (const relaxStep of RELAX_ORDER) {
    // Los primeros pasos miran sólo el barrio, como siempre; el horario y el último recurso, también los cercanos.
    if (rows.some((row) => row.matchesFilters) || !canRelax(state, relaxStep, dishes)) continue
    if (NEARBY_STEPS.includes(relaxStep) && nearbyRows.some((row) => row.matchesFilters)) continue
    // Sin el venue, la distancia a sus locales ordena.
    if (relaxStep === 'venue' && !rankOrigin) {
      scores.origins = venues.filter((venue) => state.interpretation.must.venues.includes(venue.name)).flatMap((venue) => venue.points)
    }
    state = relax(state, relaxStep)
    relaxedSteps.push(relaxStep)
    ;({ rows, nearbyRows } = await fetchCandidates())
  }
  // Los radios corren en paralelo: cuenta el más lento.
  timings.candidates =
    attempts.reduce((sum, attempt) => sum + (attempt.radiusM === undefined ? attempt.ms : 0), 0) +
    Math.max(0, ...attempts.flatMap((attempt) => (attempt.radiusM === undefined ? [] : [attempt.ms])))
  if (nearbyFilter) timings.nearby = attempts.reduce((sum, attempt) => sum + (attempt.nearby?.ms ?? 0), 0)
  const current = state.interpretation

  step = performance.now()
  const inNeighborhood = rank(rows, state)
  // Los cercanos se rankean aparte: no cambian los puestos ni el corte por relevancia del barrio.
  const nearbyRanked = nearbyFilter ? rank(nearbyRows, state) : null
  const { openAt, rankings, cut, fused: matched } = nearbyView
    ? { ...nearbyRanked!, fused: orderNearby(nearbyRanked!.fused, inNeighborhood.fused) }
    : inNeighborhood
  timings.fuse = elapsed(step)

  // Brunch con pocos "has": el tag lo tienen pocos lugares (sólo con la palabra explícita). Se completa debajo, como
  // maybe, con cafés de desayuno y almuerzo sin el tag, con los mismos demás filtros; el orden de arriba no cambia.
  // Igual si brunch viene del texto (must.tags) o del sub-filtro de la barra (o del texto absorbido por él).
  let fused = matched
  let brunchFill: { has: number; added: number; cut: ReturnType<typeof rank>['cut'] } | null = null
  const matchedHas = matched.filter((item) => item.matchLevel === 'has').length
  const wantsBrunch = current.must.tags.includes('brunch') || state.subs.includes('brunch')
  if (wantsBrunch && !nearbyView && matchedHas < SEARCH_CONFIG.brunchFill.minHas) {
    step = performance.now()
    const { categories, tags } = SEARCH_CONFIG.brunchFill
    const fillState: SearchState = {
      ...state,
      subs: state.subs.filter((id) => id !== 'brunch'),
      interpretation: { ...current, must: { ...current.must, tags: [...new Set([...current.must.tags.filter((id) => id !== 'brunch'), ...tags])] } },
    }
    const fillFilters = filtersOf(fillState)
    const fillRows = await deps.store.candidates(
      { ...fillFilters, excludeTags: [...fillFilters.excludeTags, 'brunch'], groups: [...fillFilters.groups, { categories: [...categories] }] },
      scores,
    )
    const filled = rank(fillRows, fillState)
    // Ni un lugar ni una marca que ya salieron arriba.
    const shown = new Set(matched.flatMap((item) => [item.row.id, ...item.branches.map((branch) => branch.row.id)]))
    const brands = new Set(matched.flatMap((item) => (item.row.brandKey ? [item.row.brandKey] : [])))
    const added = filled.fused.filter((item) => !shown.has(item.row.id) && !(item.row.brandKey && brands.has(item.row.brandKey)))
    for (const item of added) Object.assign(item, { matchLevel: 'maybe', filledAs: 'breakfast_lunch' })
    fused = [...matched, ...added]
    brunchFill = { has: matchedHas, added: added.length, cut: filled.cut }
    timings.brunchFill = elapsed(step)
  }

  // 5. Respuesta.
  // "Abre hoy" se muestra como ahora: "Abierto · cierra 23:00" o "Abre 20:00".
  const moment = openAt?.moment ?? montevideoNow(now)
  const isNow = openAt === null || openAt.today
  // En el grupo, sin lo que ya salió en el barrio (tampoco una marca).
  const nearbyItems = nearbyRanked && !nearbyView ? orderNearby(nearbyRanked.fused, fused) : []
  const toResult = (item: Collapsed): SearchResult => {
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
      locatedIn: item.row.locatedIn,
      lat: item.row.lat,
      lng: item.row.lng,
      branchCount: item.row.brandCount,
      branches: item.branches.map(({ row }) => ({ id: row.id, lat: row.lat, lng: row.lng })),
      reasons: buildReasons(item, { interpretation: current, dishes, dishMode: state.dishMode, intent: state.intent, subs: state.subs, near: fromUser }),
      discounts: cardProviders(item.row.discounts, filters.discounts),
      openStatus: {
        state: open.state,
        closesAt: open.state === 'open' ? open.closesAt : null,
        label: openStateLabel(open, DISPLAY_LANG, moment, isNow, next),
        ...openStateText(open, DISPLAY_LANG, moment, isNow, next),
      },
      matchLevel: item.matchLevel,
      distance: fromUser && item.row.distance !== null ? distanceLabel(item.row.distance, DISPLAY_LANG) : null,
    }
  }
  const results = fused.map(toResult)
  const nearby: SearchResponse['nearby'] = nearbyItems.length
    ? { title: nearbyTitle(wanted), label: nearbyLabel(wanted), total: nearbyItems.length, results: nearbyItems.slice(0, SEARCH_CONFIG.nearby.maxPlaces).map(toResult) }
    : null

  // Con 2 o más proveedores de descuento elegidos, los grupos son por proveedor (un lugar puede ir en varios) y
  // reemplazan a los del catálogo y a los bloques personales.
  const byDiscount = nearbyView ? null : discountSections(fused.map((item) => ({ id: item.row.id, discounts: item.row.discounts })), filters.discounts)
  // Secciones: sólo en búsquedas amplias y con suficientes resultados.
  const minResults = SEARCH_CONFIG.sections.minResults
  const notGrouped = (nearbyView ? '"Ver todos" de Cerca de' : null) ?? (byDiscount ? 'agrupado por descuento' : null) ?? notBroadReason(interpretation, { pinned: pinned !== null, section: filters.section !== null }) ??
    (fused.length < minResults ? `menos de ${minResults} resultados` : null)
  const sectionSubs = state.subs.map((id) => ({ id, fromText: resolved.subs.some((sub) => sub.id === id && sub.fromText) }))
  const sectionChoice = notGrouped ? null : requestedSections(interpretation, { fromLlm: source === 'llm', intent: state.intent, subs: sectionSubs })
  // Con una sola dieta pedida, el grupo "100 % …" (después de los personales).
  const diets = DIET_KEYS.filter((key) => interpretation.must.diet[key])
  const dietGroup = diets.length === 1 ? diets[0] : null
  const catalogOnly = sectionChoice ? buildSections(fused, sectionChoice.requested, DISPLAY_LANG, [], dietGroup) : null

  // Perfil (likes del pedido): elige lugares de esta misma búsqueda para los bloques personales; no toca el ranking.
  // Se decide si la búsqueda se agrupa sin el perfil, como siempre.
  const likes = (options.likes ?? []).slice(0, SEARCH_CONFIG.personal.maxLikes)
  const nameSearch = pinned !== null || interpretation.nameQuery !== null
  // Con pocos resultados "has" (los únicos que eligen los bloques), la fila se llevaría casi todo.
  const hasCount = fused.filter((item) => item.matchLevel === 'has').length
  const minHas = SEARCH_CONFIG.personal.minHas
  const personalSkipped =
    options.profile === false ? 'profile=off'
    : likes.length === 0 ? 'sin likes'
    : nameSearch ? 'búsqueda por nombre'
    : nearbyView ? '"Ver todos" de Cerca de'
    : byDiscount ? 'agrupado por descuento'
    : fused.length === 0 ? 'sin resultados'
    : hasCount < minHas ? `${hasCount} resultados "has" (mínimo ${minHas})`
    : null
  step = performance.now()
  const likeData = personalSkipped ? null : await deps.store.likeSimilarities(likes, fused.map((item) => item.row.id), 1 - SEARCH_CONFIG.personal.similar.topShare).catch(() => null)
  if (!personalSkipped) timings.personal = elapsed(step)
  const personal = likeData ? personalize(fused, likeData, likes, { grouped: catalogOnly?.sections != null, lang: DISPLAY_LANG, intent: state.intent, home: options.home }) : null
  const personalDebug = personal?.debug ?? emptyPersonalDebug(personalSkipped ?? 'falló la consulta de likes')
  const grouped = sectionChoice && catalogOnly?.sections && personal?.groups.length
    ? buildSections(fused, sectionChoice.requested, DISPLAY_LANG, personal.groups, dietGroup)
    : catalogOnly
  const forYou: Section | null = personal?.forYou
    ? { id: 'for_you', title: personal.forYou.title, placeIds: personal.forYou.items.map((item) => item.row.id), total: null }
    : null

  const sectionsDebug: SectionsDebug = {
    notGrouped: notGrouped ?? (grouped?.sections ? null : 'ningún grupo llegó al mínimo'),
    source: sectionChoice?.source ?? null,
    requested: sectionChoice?.requested ?? [],
    chosen: grouped?.chosen ?? [],
    dropped: grouped?.dropped ?? [],
    diet: grouped?.diet ?? null,
    displaced: grouped?.displaced ?? [],
  }

  // Avisos: cada paso se arma con el estado previo y sólo si algún resultado no cumple lo relajado.
  const shownRows = fused.filter((item) => !item.pinned).map((item) => item.row)
  // Lo relajado vale también para los cercanos: los avisos los miran a todos.
  const noticeRows = [...shownRows, ...nearbyItems.map((item) => item.row)]
  const relaxed: SearchResponse['relaxed'] = []
  if (location.kind === 'all' && location.reason === 'outside') relaxed.push({ what: 'location', message: OUTSIDE_NOTICE[DISPLAY_LANG] })
  // Cerca mío con un radio más grande que el inicial (y algún resultado más allá de él).
  const firstRadius = SEARCH_CONFIG.near.radii[0]
  if (chosenRadius !== null && chosenRadius > firstRadius && noticeRows.some((row) => row.distance !== null && row.distance > firstRadius)) {
    relaxed.push({ what: 'radius', message: radiusNotice(firstRadius, chosenRadius) })
  }
  // El barrio no tiene nada y cerca sí: se avisa y abajo va directo el grupo.
  if (fused.length === 0 && nearbyItems.length > 0) relaxed.push(emptyNeighborhoodNotice(wanted))
  // Los avisos sólo nombran la intención si la persona la eligió (barra) o la dijo con un verbo ("comer").
  const intentNamed = state.intent !== null && (intentUrl.intent === state.intent || fromText.intent === state.intent)
  let before = initial
  for (const relaxStep of relaxedSteps) {
    const notice = relaxNotice(relaxStep, {
      before,
      after: state,
      rows: noticeRows,
      dishes,
      openAt: openFilterOf(before.interpretation),
      intentNamed,
    })
    if (notice && noticeRows.length) relaxed.push(notice)
    before = relax(before, relaxStep)
  }

  // Cero resultados (un lugar fijado por nombre cuenta): sólo pueden bloquear la dieta o los exclude, que nunca se
  // relajan.
  let suggestedRemovals: Chip[] = []
  if (fused.length === 0 && nearbyItems.length === 0) {
    step = performance.now()
    const blocking = await blockingConditions(deps.store, filtersOf(state))
    const chips = chipsOf(buildChips(interpretation, today))
    suggestedRemovals = chips.filter((chip) => (blocking.diet && chip.kind === 'diet') || (blocking.exclude && chip.kind === 'exclude'))
    // La zona del mapa vacía (sin que bloqueen la dieta, los exclude ni la intención): se dice eso.
    const zoneEmpty = zone !== null && !blocking.diet && !blocking.exclude && !blocking.intent
    relaxed.push(zoneEmpty ? { what: 'zone', message: EMPTY_ZONE_NOTICE[DISPLAY_LANG] } : noMatchNotice(interpretation, blocking, intentNamed ? state.intent : null, rawQuery))
    timings.diagnose = elapsed(step)
  }
  timings.total = elapsed(started)

  const chips = chipsOf(buildChips(interpretation, today, origin !== null))
  const bar = barOf(chips)

  // Invitación a ampliar: cuántos lugares más saldrían sin cada filtro que sigue activo después de relajar (barrio,
  // horario, cada dieta, cada sub-filtro). Reusa la interpretación y el embedding: sólo SQL, un pedido por filtro.
  const widenOptions = async (): Promise<WidenOption[]> => {
    if (noticeRows.length === 0) return []
    const value = state.interpretation
    const withMust = (must: Partial<Interpretation['must']>): SearchState => ({ ...state, interpretation: { ...value, must: { ...value.must, ...must } } })
    const chipOption = (chip: Chip | undefined, kind: WidenOption['kind'], next: SearchState) =>
      chip ? [{ option: { kind, id: chip.id, label: chip.label, fromText: chip.fromText ?? false, fromFilter: chip.fromFilter ?? false }, state: next }] : []
    const removable = [
      ...(value.must.neighborhoods.length
        ? chipOption(chips.find((chip) => chip.kind === 'neighborhood' && value.must.neighborhoods.includes(chip.id)), 'neighborhood', withMust({ neighborhoods: [] }))
        : []),
      ...value.must.venues.flatMap((id) => chipOption(chips.find((chip) => chip.kind === 'venue' && chip.id === id), 'venue', withMust({ venues: value.must.venues.filter((other) => other !== id) }))),
      ...(value.must.openAt ? chipOption(chips.find((chip) => chip.kind === 'openAt'), 'openAt', withMust({ openAt: null })) : []),
      ...DIET_KEYS.filter((key) => value.must.diet[key]).flatMap((key) =>
        chipOption(chips.find((chip) => chip.kind === 'diet' && chip.id === key), 'diet', withMust({ diet: { ...value.must.diet, [key]: false } }))),
      ...state.subs.flatMap((id) => {
        const sub = bar.subs.find((entry) => entry.id === id)
        if (!sub) return []
        return [{ option: { kind: 'sub' as const, id, label: sub.label, fromText: sub.fromText, fromFilter: false }, state: { ...state, subs: state.subs.filter((other) => other !== id) } }]
      }),
    ]
    const shownIds = new Set([...fused, ...nearbyItems].flatMap((item) => [item.row.id, ...item.branches.map((branch) => branch.row.id)]))
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
    sections: byDiscount ?? grouped?.sections ?? null,
    forYou,
    nearby,
    nearbyOnly: nearbyView ? { title: nearbyTitle(wanted), label: nearbyLabel(wanted) } : null,
    relaxed,
    suggestedRemovals,
    location: location.kind === 'near' && chosenRadius !== null ? { ...location, radiusM: chosenRadius } : location,
    near: origin,
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
      if (llm.ok) costs.push({ step: 'interpret', model: llm.value.model, usd: llm.value.cost, cached: wasCached(llm.value, startedAt), ...(llm.value.cacheSource && { source: llm.value.cacheSource }), discarded: true })
    }
    const depth = SEARCH_CONFIG.debugDepth
    const collapsedInto = new Map([...fused, ...nearbyItems].flatMap((item) => item.branches.map((branch) => [branch.row.id, item.row.id] as const)))
    const debugEntry = (item: Fused, relevance: Relevance | undefined): SearchDebug['results'][number] => ({
      id: item.row.id,
      name: item.row.name,
      categories: item.row.categories,
      tags: item.row.tags,
      diet: item.row.diet,
      price: item.row.price,
      iconCategory: item.row.iconCategory,
      style: item.row.style,
      neighborhoodId: item.row.neighborhoodId,
      locatedIn: item.row.locatedIn,
      discounts: item.row.discounts,
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
      relevance: relevance!,
      brandKey: item.row.brandKey,
      collapsedInto: collapsedInto.get(item.row.id) ?? null,
      edgeDistance: item.row.edgeDistance === null ? null : Math.round(item.row.edgeDistance),
      distance: item.row.distance === null ? null : Math.round(item.row.distance),
    })
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
      near: nearDebug,
      zoneOrigin: zoneFrom ? (zoneFrom.user ? 'user' : 'center') : null,
      rankings: {
        semantic: rankings.semantic.slice(0, depth),
        keyword: rankings.keyword.slice(0, depth),
        name: rankings.name.slice(0, depth),
        distance: rankings.distance.slice(0, depth),
        quality: rankings.quality.slice(0, depth),
      },
      // En el "Ver todos" de "Cerca de", en el orden en que se muestran; después, las sucursales escondidas y lo cortado.
      results: (nearbyView ? [...new Map([...matched, ...cut.kept, ...cut.cut].map((item) => [item.row.id, item as Fused])).values()] : [...cut.kept, ...(brunchFill?.cut.kept ?? []), ...cut.cut]).map((item) => debugEntry(item, cut.relevance.get(item.row.id) ?? brunchFill?.cut.relevance.get(item.row.id))),
      nearby: nearbyItems.map((item) => debugEntry(item, nearbyRanked!.cut.relevance.get(item.row.id))),
      relevance: cut.summary,
      timings,
      cost: summarizeCost(costs),
      sections: sectionsDebug,
      personal: personalDebug,
      brunchFill: brunchFill && { has: brunchFill.has, added: brunchFill.added },
    }
  }
  return response
}
