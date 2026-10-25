import { CUISINES, FOODS, normalize } from '@shared/tags.ts'
import type { IconCategory } from '@shared/icon-categories.ts'
import type { IntentId } from '@shared/intents.ts'
import type { SectionId } from '@shared/sections.ts'
import { SEARCH_CONFIG } from './config'
import type { CandidateRow } from './candidates'
import { singularForms, type DishTarget } from './dishes'
import type { Price } from './interpretation'
import { sectionSignals } from './sections'
import { hoursConfirmed, openStatus, type OpenFilter, type OpenState } from './hours'

export type RankingName = keyof typeof SEARCH_CONFIG.rrf.weights
export type RankingEntry = { id: string; name: string; score: number }
export type Rankings = Record<RankingName, RankingEntry[]>

export type MatchLevel = 'has' | 'maybe'

export type FuseContext = {
  pinnedId: string | null
  dishes: DishTarget[]
  /** Categorías pedidas (must + prefer). */
  categories: string[]
  /** Tags pedidos (must + prefer + tags de los platos), para comparar con signature. */
  requestedTags: string[]
  preferTags: string[]
  /** Estilo pedido como preferencia; null si no se pidió. */
  preferStyle: string | null
  /** Precios pedidos (must.price); vacío si la consulta no habla de precio. */
  price: Price[]
  /** Momento pedido con openAt (today: "Abre hoy"); null si la consulta no habla de horario. */
  openAt: OpenFilter | null
  /** La consulta pide lo mejor: rango de calidad más amplio. */
  wantsBest: boolean
  /** La consulta pide bailar (boliche, dancing, dj o el sub-filtro Para bailar): los boliches no bajan. */
  wantsDancing: boolean
  /** Intención de la búsqueda (URL o texto): con Bares, los bares de verdad suman barFit; con Comer, eatFit. */
  intent: IntentId | null
  /** "Ver todos" de una sección (`f=section:<id>`): sus señales suman sectionFit. */
  section: SectionId | null
}

export type Fused = {
  row: CandidateRow
  pinned: boolean
  matchLevel: MatchLevel
  /** Estado en el momento pedido (openAt), si lo hay. */
  open: OpenState | null
  rrf: number
  boosts: Partial<Record<keyof typeof SEARCH_CONFIG.boosts, number>>
  /** RRF + empujones, antes de la calidad. */
  baseScore: number
  /** Multiplicador por prominence y featured. */
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
 * wholeWords: si la consulta no es un nombre, el ranking de nombre sólo cuenta los nombres que tienen alguna de sus
 * palabras entera ("milanesa" → "El Club de la Milanesa"; "comer" no → "Misión Comedor"). null con un nombre del
 * modelo o fijado, que se busca difuso. Un nombre casi idéntico igual se fija por strongNameMatch.
 */
export function buildRankings(rows: CandidateRow[], { withQuality = false, wholeWords = null }: { withQuality?: boolean; wholeWords?: string[] | null } = {}): Rankings {
  const wanted = wholeWords && new Set(wholeWords.flatMap(singularForms))
  const nameOk = (row: CandidateRow) => !wanted || [...nameWords(row.name)].some((word) => wanted.has(word))
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

/** has: el plato está en dishes o en el texto (o es genérico y tiene el tag); maybe: sólo el tag relacionado. */
export function matchLevelOf(row: CandidateRow, dishes: DishTarget[]): MatchLevel {
  if (dishes.length === 0) return 'has'
  const has = dishes.some(
    (target, index) =>
      row.dishHas[index] ||
      (target.generic && ((target.tag !== null && row.tags.includes(target.tag)) || (target.category !== null && row.categories.includes(target.category)))),
  )
  return has ? 'has' : 'maybe'
}

const count = (values: string[], wanted: string[]) => values.filter((value) => wanted.includes(value)).length

/** Íconos de bebida: el lugar es conocido por lo que se toma. */
export const DRINK_ICONS = new Set<IconCategory>(['wine', 'beer', 'beer_pub', 'cocktails', 'tropical_drinks', 'classic_bar'])

/**
 * Íconos de comida de plato: el lugar es para comer. Sin café, pastelería, dulces, desayuno ni bebida, que no
 * restan pero tampoco suman con Comer.
 */
export const EAT_ICONS = new Set<IconCategory>([
  'grill', 'meat', 'pasta', 'pizza', 'burger', 'fries', 'sandwich', 'hot_dog', 'taco', 'burrito', 'tamale', 'seafood', 'fish',
  'octopus', 'tapas', 'sushi', 'ramen', 'wok', 'dumplings', 'curry', 'falafel', 'kebab', 'salad',
])

const FOOD_TAGS = new Set<string>([...Object.keys(FOODS), ...Object.keys(CUISINES)])
const FOOD_CATEGORIES = new Set(['restaurant', 'grill', 'pizzeria', 'chiviteria', 'bodegon'])

/**
 * Boliche, o "para bailar" o un dj sin nada de comida: lo que se busca es bailar, no comer ni tomar algo. Un pub que
 * sirve comida y después se vuelve boliche no cuenta.
 */
export function isDanceOnly(row: Pick<CandidateRow, 'categories' | 'tags'>): boolean {
  if (row.categories.includes('night_club')) return true
  const food = row.tags.some((id) => FOOD_TAGS.has(id)) || row.categories.some((id) => FOOD_CATEGORIES.has(id))
  return (row.tags.includes('dancing') || row.tags.includes('dj')) && !food
}

export function boostsFor(row: CandidateRow, context: FuseContext, open: OpenState | null): Fused['boosts'] {
  const { boosts } = SEARCH_CONFIG
  const result: Fused['boosts'] = {}
  if (count(row.categories, context.categories) > 0) result.category = boosts.category
  const signature = Math.min(count(row.signature, [...context.requestedTags, ...context.categories]), boosts.maxSignatureMatches)
  if (signature > 0) result.signature = signature * (context.wantsBest ? boosts.signatureBest : boosts.signature)
  const prefer = count(row.tags, context.preferTags)
  if (prefer > 0) result.preferTag = prefer * boosts.preferTag
  if (context.preferStyle && row.style === context.preferStyle) result.preferStyle = boosts.preferStyle
  // price = 'unknown' pasa el filtro pero no suma: lo confirmado va primero.
  if (context.price.length > 0 && (context.price as string[]).includes(row.price)) result.priceMatch = boosts.priceMatch
  if (row.dishExact.some(Boolean)) result.exactDish = boosts.exactDish
  const knownFor = context.dishes.some((target) =>
    (row.iconCategory !== null && target.icons.includes(row.iconCategory)) || (target.category !== null && row.categories.includes(target.category)))
  if (knownFor) result.knownFor = boosts.knownFor
  if (context.intent === 'bars' && row.iconCategory !== null && DRINK_ICONS.has(row.iconCategory)) result.barFit = boosts.barFit
  if (context.intent === 'eat' && row.iconCategory !== null && EAT_ICONS.has(row.iconCategory)) result.eatFit = boosts.eatFit
  const signals = context.section ? sectionSignals(context.section, row) : 0
  if (signals > 0) result.sectionFit = signals * boosts.sectionFit
  // "Abre hoy" no empuja a los abiertos: ordena la relevancia y la card dice si abre más tarde.
  if (!context.openAt?.today && open?.state === 'open' && hoursConfirmed(row.hours)) result.confirmedOpen = boosts.confirmedOpen
  if (!context.wantsDancing && isDanceOnly(row)) result.danceOnly = boosts.danceOnly
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
      const multiplier = qualityMultiplier(row, context.wantsBest)
      return {
        row,
        pinned: row.id === context.pinnedId,
        matchLevel: matchLevelOf(row, context.dishes),
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
