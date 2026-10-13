import { SEARCH_CONFIG } from './config'
import type { CandidateRow } from './candidates'
import type { DishTarget } from './dishes'
import { hoursConfirmed, openStatus, type Moment, type OpenState } from './hours'

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
  /** Momento pedido con openAt; null si la consulta no habla de horario. */
  openAt: Moment | null
}

export type Fused = {
  row: CandidateRow
  pinned: boolean
  matchLevel: MatchLevel
  /** Estado en el momento pedido (openAt), si lo hay. */
  open: OpenState | null
  rrf: number
  boosts: Partial<Record<keyof typeof SEARCH_CONFIG.boosts, number>>
  score: number
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

export function buildRankings(rows: CandidateRow[]): Rankings {
  return {
    semantic: ranked(rows, (row) => row.semantic, 'desc'),
    keyword: ranked(rows, (row) => (row.keyword > 0 ? row.keyword : null), 'desc'),
    name: ranked(rows, (row) => (row.nameScore >= SEARCH_CONFIG.name.minForRanking ? row.nameScore : null), 'desc'),
    distance: ranked(rows, (row) => row.distance, 'asc'),
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

export function boostsFor(row: CandidateRow, context: FuseContext, open: OpenState | null): Fused['boosts'] {
  const { boosts } = SEARCH_CONFIG
  const result: Fused['boosts'] = {}
  if (count(row.categories, context.categories) > 0) result.category = boosts.category
  const signature = Math.min(count(row.signature, [...context.requestedTags, ...context.categories]), boosts.maxSignatureMatches)
  if (signature > 0) result.signature = signature * boosts.signature
  const prefer = count(row.tags, context.preferTags)
  if (prefer > 0) result.preferTag = prefer * boosts.preferTag
  if (row.dishExact.some(Boolean)) result.exactDish = boosts.exactDish
  if (open?.state === 'open' && hoursConfirmed(row.hours)) result.confirmedOpen = boosts.confirmedOpen
  return result
}

const tierOf = (item: Fused, context: FuseContext) => [
  item.pinned ? 0 : 1,
  item.matchLevel === 'has' ? 0 : 1,
  // Con openAt: abiertos confirmados, después sin confirmar, al final los cerrados (sólo un fijado por nombre).
  context.openAt ? (item.open?.state === 'open' ? 0 : item.open?.state === 'unconfirmed' ? 1 : 2) : 0,
]

export function fuse(rows: CandidateRow[], rankings: Rankings, context: FuseContext): Fused[] {
  const rrf = reciprocalRankFusion(rankings)
  const fused = rows
    .filter((row) => row.matchesFilters || row.id === context.pinnedId)
    .map((row): Fused => {
      const open = context.openAt ? openStatus(row.hours, context.openAt) : null
      const boosts = boostsFor(row, context, open)
      const base = rrf.get(row.id) ?? 0
      return {
        row,
        pinned: row.id === context.pinnedId,
        matchLevel: matchLevelOf(row, context.dishes),
        open,
        rrf: base,
        boosts,
        score: base + Object.values(boosts).reduce((sum, value) => sum + (value ?? 0), 0),
      }
    })
  return fused.sort((a, b) => {
    const tierA = tierOf(a, context)
    const tierB = tierOf(b, context)
    for (let index = 0; index < tierA.length; index++) if (tierA[index] !== tierB[index]) return tierA[index] - tierB[index]
    return b.score - a.score
  })
}
