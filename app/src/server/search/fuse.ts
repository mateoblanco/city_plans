import { hasPartialTags, isOccasionTag, normalize, withPartialTags } from '@shared/tags.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import type { IntentId, INTENTS } from '@shared/intents.ts'
import type { SectionId } from '@shared/sections.ts'
import { SEARCH_CONFIG } from './config'
import type { CandidateRow } from './candidates'
import { isMainCuisine } from './cuisines'
import { singularForms, type DishTarget } from './dishes'
import type { DietKey, Price } from './interpretation'
import { groupFit, matchesMoment, momentSignals } from './moments'
import { sectionPartialTags, sectionSignals } from './sections'
import { hoursConfirmed, openStatus, type OpenFilter, type OpenState } from './hours'
import { distanceFactor } from './location'

export type RankingName = keyof typeof SEARCH_CONFIG.rrf.weights
export type RankingEntry = { id: string; name: string; score: number }
export type Rankings = Record<RankingName, RankingEntry[]>

export type MatchLevel = 'has' | 'maybe'

export type FuseContext = {
  pinnedId: string | null
  /** Cerca mío: el puntaje se multiplica también por la distancia (location.ts distanceFactor). */
  nearDecay?: boolean
  dishes: DishTarget[]
  /** Categorías pedidas (must + prefer). */
  categories: string[]
  /** Tags pedidos (must + prefer + tags de los platos), para comparar con signature. */
  requestedTags: string[]
  preferTags: string[]
  /** Tags de prefer que tienen pocos candidatos (rareTagsOf): pesan más que signature + nombre. */
  rareTags?: string[]
  /** Momentos pedidos como preferencia (moments.ts momentsOf): ordenan como un plato y suman momentFit. */
  moments: string[]
  /** Cocinas pedidas (must + prefer, cuisines.ts requestedCuisines): los que no la tienen como principal son maybe. */
  cuisines: string[]
  /** Estilo pedido como preferencia; null si no se pidió. */
  preferStyle: string | null
  /** Dietas pedidas (must.diet): los lugares 100 % aptos suman dietFully. */
  diet: DietKey[]
  /** Dietas preferidas sin filtrar (sin carne → vegetariano): suman preferDiet, entero si es 100 % y la mitad con opciones. */
  preferDiet: DietKey[]
  /** Precios pedidos (must.price); vacío si la consulta no habla de precio. */
  price: Price[]
  /** Momento pedido con openAt (today: "Abre hoy"); null si la consulta no habla de horario. */
  openAt: OpenFilter | null
  /** La consulta pide lo mejor: rango de calidad más amplio. */
  wantsBest: boolean
  /** Lo de la noche baja aunque no se pidan niños: "con mis viejos" (dictionary.ts mentionsParents). */
  avoidNight?: boolean
  /**
   * Intención de la búsqueda (URL o texto): con Bares, los bares de verdad suman barFit; con Comer, eatFit. Una bebida
   * pedida (requestedTags) también da barFit, aunque no haya intención.
   */
  intent: IntentId | null
  /** Sub-filtros activos de la intención (URL o texto): el lugar con su señal específica (SUB_SIGNALS) suma subFit. */
  subs?: string[]
  /** "Ver todos" de una sección (`f=section:<id>`): sus señales suman sectionFit. */
  section: SectionId | null
  /**
   * Tags exigidos que aceptan parecidos (PARTIAL_TAGS), de must o de la regla de la sección del "Ver todos": el lugar
   * que sólo tiene un parecido (terraza con "al aire libre") es maybe, siempre después de los que tienen el tag.
   */
  partialTags?: string[]
}

export type Fused = {
  row: CandidateRow
  pinned: boolean
  /**
   * has: tiene lo pedido; maybe: puede que no (el plato sólo por el tag, no tiene el momento pedido, o la consulta pide
   * precio y el suyo es desconocido).
   */
  matchLevel: MatchLevel
  /** Relleno de brunch (search.ts): café con desayuno y almuerzo, sin el tag brunch. Siempre maybe. */
  filledAs?: 'breakfast_lunch'
  /** El nivel sólo por el plato, para el corte por relevancia. */
  dishLevel: MatchLevel
  /** Estado en el momento pedido (openAt), si lo hay. */
  open: OpenState | null
  rrf: number
  boosts: Partial<Record<keyof typeof SEARCH_CONFIG.boosts, number>>
  /** RRF + empujones, antes de la calidad. */
  baseScore: number
  /** Multiplicador por prominence y featured (y, con cerca mío, por la distancia). */
  multiplier: number
  /** baseScore × multiplier: con esto se ordena dentro de cada nivel. */
  score: number
  /** Puesto (desde 1) que tendría ordenando por baseScore, para ver qué movió la calidad. */
  positionWithoutQuality: number
}

function ranked(rows: CandidateRow[], value: (row: CandidateRow) => number | null, direction: 'asc' | 'desc'): RankingEntry[] {
  return rows
    .flatMap((row) => {
      const score = value(row)
      return score === null || !Number.isFinite(score) ? [] : [{ id: row.id, name: row.name, score }]
    })
    .sort((a, b) => (direction === 'desc' ? b.score - a.score : a.score - b.score))
    .slice(0, SEARCH_CONFIG.rankingDepth)
}

const nameWords = (name: string) => new Set(normalize(name).split(/[^a-z0-9]+/).filter(Boolean).flatMap(singularForms))

/**
 * withQuality: búsqueda sin texto, donde el orden sale de la calidad (featured primero, después prominence).
 * wholeWords: si la consulta no es un nombre, sus palabras distintivas (search.ts distinctiveNameWords). El ranking de
 * nombre sólo cuenta los nombres que las tienen todas enteras ("milanesa" → "El Club de la Milanesa"; "comer" no →
 * "Misión Comedor"; "café lindo con plantas" no → "Planta Baja"); sin ninguna, nadie entra. null con un nombre del modelo
 * o fijado, que se busca difuso. Un nombre casi idéntico igual se fija por strongNameMatch.
 */
export function buildRankings(rows: CandidateRow[], { withQuality = false, wholeWords = null }: { withQuality?: boolean; wholeWords?: string[] | null } = {}): Rankings {
  const nameOk = (row: CandidateRow) => {
    if (!wholeWords) return true
    if (wholeWords.length === 0) return false
    const words = nameWords(row.name)
    return wholeWords.every((word) => singularForms(word).some((form) => words.has(form)))
  }
  return {
    semantic: ranked(rows, (row) => row.semantic, 'desc'),
    keyword: ranked(rows, (row) => (row.keyword > 0 ? row.keyword : null), 'desc'),
    name: ranked(rows, (row) => (row.nameScore >= SEARCH_CONFIG.name.minForRanking && nameOk(row) ? row.nameScore : null), 'desc'),
    distance: ranked(rows, (row) => row.distance, 'asc'),
    quality: withQuality ? ranked(rows, (row) => (row.featured ? 1 : 0) + (Number(row.prominence) || 0), 'desc') : [],
  }
}

/** Reciprocal rank fusion: suma de peso / (k + puesto) en cada ranking donde aparece el lugar. */
export function reciprocalRankFusion(rankings: Rankings): Map<string, number> {
  const scores = new Map<string, number>()
  for (const [name, entries] of Object.entries(rankings) as [RankingName, RankingEntry[]][]) {
    const weight = SEARCH_CONFIG.rrf.weights[name]
    entries.forEach((entry, index) => {
      scores.set(entry.id, (scores.get(entry.id) ?? 0) + weight / (SEARCH_CONFIG.rrf.k + index + 1))
    })
  }
  return scores
}

/**
 * has: el plato está en dishes o en el texto (o es genérico y tiene el tag); maybe: sólo el tag relacionado. Con precio
 * pedido, un precio desconocido es maybe: el filtro ya lo saca, así que sólo pasa con un lugar fijado por nombre.
 * Con un momento pedido (cita, con amigos…), los que no lo cumplen (su tag o, con grupos, moments.ts fitsGroup) son maybe,
 * como un plato; con plato y momento, has pide los dos. Con una cocina pedida, igual: has si es su cocina principal
 * (signature o ícono, cuisines.ts); con el tag solo (un par de platos peruanos en un bar de tapas), maybe.
 */
export function matchLevelOf(
  row: Pick<CandidateRow, 'dishHas' | 'tags' | 'categories' | 'price' | 'signature' | 'iconCategory' | 'style'>,
  dishes: DishTarget[],
  price: readonly string[] = [],
  moments: readonly string[] = [],
  cuisines: readonly string[] = [],
  partialTags: readonly string[] = [],
): MatchLevel {
  if (price.length > 0 && row.price === 'unknown') return 'maybe'
  if (partialTags.some((id) => !row.tags.includes(id))) return 'maybe'
  if (moments.length > 0 && !matchesMoment(moments, row)) return 'maybe'
  if (cuisines.length > 0 && !cuisines.some((id) => isMainCuisine(row, id))) return 'maybe'
  if (dishes.length === 0) return 'has'
  const has = dishes.some(
    (target, index) =>
      row.dishHas[index] ||
      (target.generic && ((target.tag !== null && row.tags.includes(target.tag)) || (target.category !== null && row.categories.includes(target.category)))),
  )
  return has ? 'has' : 'maybe'
}

/** Nivel de dieta del lugar; un vegano fully es vegetariano fully. */
export function dietLevel(row: Pick<CandidateRow, 'diet'>, key: DietKey): string {
  return key === 'vegetarian' && row.diet.vegan === 'fully' ? 'fully' : row.diet[key]
}

export const isDietFully = (row: Pick<CandidateRow, 'diet'>, key: DietKey) => dietLevel(row, key) === 'fully'

const count = (values: string[], wanted: string[]) => values.filter((value) => wanted.includes(value)).length

/** Íconos de bebida: el lugar es conocido por lo que se toma. */
export const DRINK_ICONS = new Set<IconCategory>(['wine', 'beer', 'beer_pub', 'cocktails', 'tropical_drinks', 'classic_bar'])

// Bebida pedida → ícono o categoría del bar conocido por ella: ése suma barFit entero y los otros bares, la mitad.
type DrinkFit = { icons: IconCategory[]; categories: string[] }
const WINE: DrinkFit = { icons: ['wine'], categories: ['wine_bar'] }
const BEER: DrinkFit = { icons: ['beer', 'beer_pub'], categories: ['brewery'] }
const COCKTAILS: DrinkFit = { icons: ['cocktails'], categories: [] }
const CLASSIC: DrinkFit = { icons: ['classic_bar'], categories: [] }
export const DRINK_FIT: Record<string, DrinkFit> = {
  wine: WINE,
  craft_beer: BEER, draft_beer: BEER,
  signature_cocktails: COCKTAILS, classic_cocktails: COCKTAILS, gin: COCKTAILS,
  vermouth: CLASSIC, whisky: CLASSIC,
}

/** barFit del lugar: con una bebida pedida, entero para su bar y la mitad para los otros; sin bebida, sólo con Bares. */
function barFitOf(row: CandidateRow, context: FuseContext): number {
  const full = SEARCH_CONFIG.boosts.barFit
  const fits = context.requestedTags.flatMap((id) => DRINK_FIT[id] ?? [])
  const drinkIcon = row.iconCategory !== null && DRINK_ICONS.has(row.iconCategory)
  if (fits.length === 0) return context.intent === 'bars' && drinkIcon ? full : 0
  const matches = fits.some((fit) => (row.iconCategory !== null && fit.icons.includes(row.iconCategory)) || row.categories.some((id) => fit.categories.includes(id)))
  return matches ? full : drinkIcon ? full / 2 : 0
}

/**
 * Íconos de comida de plato: el lugar es para comer. Sin café, pastelería, dulces, desayuno ni bebida, que no
 * restan pero tampoco suman con Comer.
 */
export const EAT_ICONS = new Set<IconCategory>([
  'grill', 'meat', 'pasta', 'pizza', 'burger', 'fries', 'sandwich', 'hot_dog', 'taco', 'burrito', 'tamale', 'seafood', 'fish',
  'octopus', 'tapas', 'sushi', 'ramen', 'wok', 'dumplings', 'curry', 'falafel', 'kebab', 'salad',
])

/** Categorías que dan la mitad de eatFit aunque el ícono sea de café o bar (Savarin, bodegones con ícono de bar). */
const EAT_CATEGORIES = new Set(['restaurant', 'bodegon'])

/**
 * Postres: íconos de un lugar de postres o helado. El tag desserts no sirve para separar (lo tiene la mayoría: cualquier
 * carta con postres), así que no suma.
 */
export const DESSERT_ICONS = new Set<IconCategory>(['cake', 'cupcake', 'pie', 'birthday_cake', 'donut', 'cookie', 'chocolate', 'ice_cream'])
/** Íconos de pastelería o panadería: con categoría de café o panadería y el tag pastries, el café con pastelería. */
const PASTRY_ICONS = new Set<IconCategory>(['croissant', 'bread', 'bakery'])

/**
 * dessertFit del lugar con la intención Postres: entero para el lugar de postres (heladería, o ícono de postre o
 * helado); la mitad para el café o la panadería con pastelería (tag pastries o ícono de pastelería). Lo demás, nada.
 */
export function dessertFitOf(row: Pick<CandidateRow, 'categories' | 'tags' | 'iconCategory'>): number {
  const full = SEARCH_CONFIG.boosts.dessertFit
  if (row.categories.includes('ice_cream_shop') || (row.iconCategory !== null && DESSERT_ICONS.has(row.iconCategory))) return full
  const cafe = row.categories.includes('cafe') || row.categories.includes('bakery')
  const pastry = row.tags.includes('pastries') || (row.iconCategory !== null && PASTRY_ICONS.has(row.iconCategory))
  return cafe && pastry ? full * SEARCH_CONFIG.boosts.dessertFitPartial : 0
}

/**
 * La señal más específica de cada sub-filtro, más fina que su filtro (que ya cumplen todos): ícono, categoría, un tag
 * más angosto o el tag en signature (lo que define al lugar). null: no hay una señal mejor que el tag del filtro
 * (almuerzo y cena los tiene casi todo lugar para comer y nunca están en signature).
 */
export type SubSignal = { icons?: IconCategory[]; categories?: string[]; tags?: string[]; signature?: string[] }
const BREAKFAST_SIGNAL: SubSignal = { icons: ['breakfast', 'pancakes'], signature: ['breakfast'] }
const BRUNCH_SIGNAL: SubSignal = { icons: ['pancakes'], signature: ['brunch'] }
export const SUB_SIGNALS: { [K in IntentId]: Record<keyof (typeof INTENTS)[K]['subs'], SubSignal | null> } = {
  eat: { breakfast: BREAKFAST_SIGNAL, brunch: BRUNCH_SIGNAL, lunch: null, dinner: null },
  cafes: {
    specialty: { icons: ['coffee'], signature: ['specialty_coffee'] },
    pastries: { icons: [...PASTRY_ICONS, ...DESSERT_ICONS].filter((icon) => icon !== 'ice_cream'), categories: ['bakery'], signature: ['pastries'] },
    brunch: BRUNCH_SIGNAL,
    work: { signature: ['work'] },
  },
  bars: {
    cocktails: { icons: ['cocktails'], tags: ['signature_cocktails'] },
    wine: { icons: ['wine'], categories: ['wine_bar'], signature: ['wine'] },
    beer: { icons: ['beer', 'beer_pub'], categories: ['brewery'], tags: ['craft_beer'] },
    live_music: { signature: ['live_music'] },
    live_sports: { signature: ['watch_football'] },
  },
  desserts: {
    ice_cream: { icons: ['ice_cream'], categories: ['ice_cream_shop'] },
    pastries: { icons: [...DESSERT_ICONS].filter((icon) => icon !== 'ice_cream'), signature: ['pastries'] },
  },
}

export const subSignal = (intent: IntentId | null, sub: string): SubSignal | null =>
  intent ? ((SUB_SIGNALS[intent] as Record<string, SubSignal | null>)[sub] ?? null) : null

const hasSubSignal = (row: Pick<CandidateRow, 'categories' | 'tags' | 'signature' | 'iconCategory'>, signal: SubSignal) =>
  (row.iconCategory !== null && (signal.icons ?? []).includes(row.iconCategory)) ||
  (signal.categories ?? []).some((id) => row.categories.includes(id)) ||
  (signal.tags ?? []).some((id) => row.tags.includes(id)) ||
  (signal.signature ?? []).some((id) => row.signature.includes(id))

/** Cuántos sub-filtros activos tienen su señal específica en el lugar. */
export function subSignalCount(row: Pick<CandidateRow, 'categories' | 'tags' | 'signature' | 'iconCategory'>, intent: IntentId | null, subs: string[]): number {
  return subs.filter((id) => {
    const signal = subSignal(intent, id)
    return signal !== null && hasSubSignal(row, signal)
  }).length
}

/**
 * Por cada tag pedido que acepta parecidos (PARTIAL_TAGS): partialTag entero si el lugar tiene el tag y partialTagShare
 * del entero si sólo tiene un parecido ("al aire libre": primero los del tag, después terrazas, patios y azoteas). Ordena
 * con el tag en prefer; exigido (partialTags), además el parecido es maybe.
 */
export function partialTagFit(row: Pick<CandidateRow, 'tags'>, wanted: readonly string[]): number {
  const { partialTag, partialTagShare } = SEARCH_CONFIG.boosts
  return [...new Set(wanted)].filter(hasPartialTags).reduce((sum, id) => {
    if (row.tags.includes(id)) return sum + partialTag
    return withPartialTags(id).some((tag) => row.tags.includes(tag)) ? sum + partialTag * partialTagShare : sum
  }, 0)
}

/** Tags de prefer, sin momentos, que tienen rareTagMaxPlaces lugares o menos entre los que cumplen los filtros. */
export function rareTagsOf(rows: Pick<CandidateRow, 'tags' | 'matchesFilters'>[], preferTags: string[]): string[] {
  const matching = rows.filter((row) => row.matchesFilters)
  return preferTags.filter((id) => !isOccasionTag(id) && matching.filter((row) => row.tags.includes(id)).length <= SEARCH_CONFIG.boosts.rareTagMaxPlaces)
}

/**
 * Lo de la noche que baja con niños pedido (kidsNight): trasnoche sólo en un bar sin restaurant (un restaurante que
 * cierra tarde sigue siendo para ir con chicos).
 */
export function isKidsNight(row: Pick<CandidateRow, 'categories' | 'tags'>): boolean {
  return row.tags.includes('late_night') && row.categories.includes('bar') && !row.categories.includes('restaurant')
}

export function boostsFor(row: CandidateRow, context: FuseContext, open: OpenState | null): Fused['boosts'] {
  const { boosts } = SEARCH_CONFIG
  const result: Fused['boosts'] = {}
  if (count(row.categories, context.categories) > 0) result.category = boosts.category
  const signature = Math.min(count(row.signature, [...context.requestedTags, ...context.categories]), boosts.maxSignatureMatches)
  if (signature > 0) result.signature = signature * (context.wantsBest ? boosts.signatureBest : boosts.signature)
  const prefer = count(row.tags, context.preferTags)
  if (prefer > 0) result.preferTag = prefer * boosts.preferTag
  if (context.rareTags && count(row.tags, context.rareTags) > 0) result.rareTag = boosts.rareTag
  const partial = partialTagFit(row, [...context.requestedTags, ...(context.section ? sectionPartialTags(context.section) : [])])
  if (partial > 0) result.partialTag = partial
  if (context.preferStyle && row.style === context.preferStyle) result.preferStyle = boosts.preferStyle
  if (row.dishExact.some(Boolean)) result.exactDish = boosts.exactDish
  const knownFor = context.dishes.some((target) =>
    (row.iconCategory !== null && target.icons.includes(row.iconCategory)) || (target.category !== null && row.categories.includes(target.category)))
  if (knownFor) result.knownFor = boosts.knownFor
  const fully = context.diet.filter((key) => isDietFully(row, key)).length
  if (fully > 0) result.dietFully = fully * boosts.dietFully
  const preferDiet = context.preferDiet.reduce((sum, key) => sum + (isDietFully(row, key) ? 1 : dietLevel(row, key) === 'has_options' ? 0.5 : 0), 0)
  if (preferDiet > 0) result.preferDiet = preferDiet * boosts.preferDiet
  const barFit = barFitOf(row, context)
  if (barFit > 0) result.barFit = barFit
  if (context.intent === 'eat') {
    if (row.iconCategory !== null && EAT_ICONS.has(row.iconCategory)) result.eatFit = boosts.eatFit
    else if (row.categories.some((id) => EAT_CATEGORIES.has(id))) result.eatFit = boosts.eatFit / 2
  }
  if (context.intent === 'desserts') {
    const dessertFit = dessertFitOf(row)
    if (dessertFit > 0) result.dessertFit = dessertFit
  }
  const subSignals = subSignalCount(row, context.intent, context.subs ?? [])
  if (subSignals > 0) result.subFit = subSignals * boosts.subFit
  const signals = context.section ? sectionSignals(context.section, row) : 0
  if (signals > 0) result.sectionFit = signals * boosts.sectionFit
  const moment = momentSignals(context.moments, row)
  if (moment > 0) result.momentFit = moment * boosts.momentFit
  const group = groupFit(context.moments, row)
  if (group > 0) result.groupFit = group
  // "Abre hoy" no empuja a los abiertos: ordena la relevancia y la card dice si abre más tarde.
  if (!context.openAt?.today && open?.state === 'open' && hoursConfirmed(row.hours)) result.confirmedOpen = boosts.confirmedOpen
  const kids = context.requestedTags.includes('kids_friendly')
  if (kids && row.tags.includes('kids_area')) result.kidsArea = boosts.kidsArea
  if ((kids || context.avoidNight) && isKidsNight(row)) result.kidsNight = boosts.kidsNight
  return result
}

/** Lineal entre prominenceMin (0) y prominenceMax (1), por el extra de featured. */
export function qualityMultiplier(row: Pick<CandidateRow, 'prominence' | 'featured'>, wantsBest: boolean): number {
  const range = wantsBest ? SEARCH_CONFIG.quality.best : SEARCH_CONFIG.quality.normal
  const prominence = Math.min(1, Math.max(0, Number(row.prominence) || 0))
  return (range.prominenceMin + (range.prominenceMax - range.prominenceMin) * prominence) * (row.featured ? range.featured : 1)
}

const tierOf = (item: Fused, context: FuseContext) => [
  item.pinned ? 0 : 1,
  item.matchLevel === 'has' ? 0 : 1,
  // Con openAt: abiertos confirmados, después sin confirmar, al final los cerrados (sólo un fijado por nombre).
  // Con "Abre hoy" los confirmados van juntos (abiertos o que abren más tarde) y los sin confirmar al final.
  !context.openAt ? 0 : item.open?.state === 'unconfirmed' ? 1 : context.openAt.today || item.open?.state === 'open' ? 0 : 2,
]

export function fuse(rows: CandidateRow[], rankings: Rankings, context: FuseContext): Fused[] {
  const rrf = reciprocalRankFusion(rankings)
  const fused = rows
    .filter((row) => row.matchesFilters || row.id === context.pinnedId)
    .map((row): Fused => {
      const open = context.openAt ? openStatus(row.hours, context.openAt.moment) : null
      const boosts = boostsFor(row, context, open)
      const base = rrf.get(row.id) ?? 0
      const baseScore = base + Object.values(boosts).reduce((sum, value) => sum + (value ?? 0), 0)
      const multiplier = qualityMultiplier(row, context.wantsBest) * (context.nearDecay ? distanceFactor(row.distance) : 1)
      return {
        row,
        pinned: row.id === context.pinnedId,
        matchLevel: matchLevelOf(row, context.dishes, context.price, context.moments, context.cuisines, context.partialTags),
        dishLevel: matchLevelOf(row, context.dishes),
        open,
        rrf: base,
        boosts,
        baseScore,
        multiplier,
        score: baseScore * multiplier,
        positionWithoutQuality: 0,
      }
    })
  const byTier = (score: (item: Fused) => number) => (a: Fused, b: Fused) => {
    const tierA = tierOf(a, context)
    const tierB = tierOf(b, context)
    for (let index = 0; index < tierA.length; index++) if (tierA[index] !== tierB[index]) return tierA[index] - tierB[index]
    return score(b) - score(a)
  }
  const withoutQuality = [...fused].sort(byTier((item) => item.baseScore))
  withoutQuality.forEach((item, index) => {
    item.positionWithoutQuality = index + 1
  })
  return fused.sort(byTier((item) => item.score))
}
