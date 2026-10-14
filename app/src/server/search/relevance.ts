import { SEARCH_CONFIG } from './config'
import type { Fused } from './fuse'

/** Por qué un resultado pasa el corte; `no-similarity`: el lugar no tiene embedding, no hay con qué compararlo. */
export type KeptBy = 'pinned' | 'category' | 'tag' | 'dish' | 'keyword' | 'similar' | 'no-similarity'
export type Relevance = { kept: KeptBy } | { cut: true; reason: string }

export type RelevanceContext = {
  /** Hubo embedding de la consulta; sin él (sin texto o si falló) no se corta nada. */
  hasEmbedding: boolean
  /** Categorías pedidas (must + prefer). */
  categories: string[]
  /** Tags pedidos (must + prefer + tags relacionados de los platos). */
  tags: string[]
  hasDishes: boolean
}

export type RelevanceCut = {
  kept: Fused[]
  cut: Fused[]
  relevance: Map<string, Relevance>
  /** null si no se cortó por falta de embedding. */
  summary: { best: number; threshold: number; gap: number } | null
}

const decimal = (value: number) => value.toFixed(3).replace('.', ',')

/** Qué pidió la consulta explícitamente y tiene el lugar; null si nada. */
function explicitMatch(item: Fused, context: RelevanceContext): KeptBy | null {
  const { row } = item
  if (item.pinned) return 'pinned'
  if (row.categories.some((id) => context.categories.includes(id))) return 'category'
  if (row.tags.some((id) => context.tags.includes(id))) return 'tag'
  if (context.hasDishes && (row.dishHas.some(Boolean) || row.dishExact.some(Boolean) || item.matchLevel === 'has')) return 'dish'
  if (row.keyword > 0) return 'keyword'
  return null
}

/**
 * Saca los resultados cuya similitud semántica está más de maxSemanticGap por debajo del más parecido y que no
 * coinciden con nada explícito de la consulta. Mantiene el orden de la fusión.
 */
export function relevanceCut(fused: Fused[], context: RelevanceContext): RelevanceCut {
  const relevance = new Map<string, Relevance>()
  const similarities = fused.flatMap((item) => (item.row.semantic === null ? [] : [item.row.semantic]))
  if (!context.hasEmbedding || similarities.length === 0) {
    for (const item of fused) relevance.set(item.row.id, { kept: explicitMatch(item, context) ?? 'no-similarity' })
    return { kept: fused, cut: [], relevance, summary: null }
  }
  const gap = SEARCH_CONFIG.relevance.maxSemanticGap
  const best = Math.max(...similarities)
  // Redondeado para que "justo en el umbral" no se pierda por coma flotante.
  const threshold = Math.round((best - gap) * 1e6) / 1e6
  const kept: Fused[] = []
  const cut: Fused[] = []
  for (const item of fused) {
    const similarity = item.row.semantic
    const explicit = explicitMatch(item, context)
    const verdict: Relevance =
      explicit ? { kept: explicit }
      : similarity === null ? { kept: 'no-similarity' }
      : similarity >= threshold ? { kept: 'similar' }
      : { cut: true, reason: `similitud ${decimal(similarity)} < ${decimal(threshold)} (mejor ${decimal(best)} − ${gap.toFixed(2).replace(".", ",")}), sin coincidencia explícita` }
    relevance.set(item.row.id, verdict)
    ;('cut' in verdict ? cut : kept).push(item)
  }
  return { kept, cut, relevance, summary: { best, threshold, gap } }
}
