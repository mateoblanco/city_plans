import { describe, expect, it } from 'vitest'
import type { Fused } from './fuse'
import { relevanceCut, type RelevanceContext } from './relevance'
import { row } from './test/fixtures'

const item = (overrides: Parameters<typeof row>[0], pinned = false): Fused => ({
  row: row(overrides),
  pinned,
  // Con platos pedidos, 'has' ya es una coincidencia: por defecto, ninguna.
  matchLevel: 'maybe',
  open: null,
  rrf: 0,
  boosts: {},
  baseScore: 0,
  multiplier: 1,
  score: 0,
  positionWithoutQuality: 0,
})
const context: RelevanceContext = { hasEmbedding: true, categories: ['pizzeria'], tags: ['pizza'], hasDishes: false }
const kept = (fused: Fused[], ctx = context) => relevanceCut(fused, ctx).kept.map((entry) => entry.row.id)

describe('corte por relevancia', () => {
  it('saca lo que queda más de 0,08 por debajo del más parecido y no coincide con nada explícito', () => {
    const result = relevanceCut([item({ id: 'mejor', semantic: 0.45 }), item({ id: 'lejos', semantic: 0.3 })], context)
    expect(result.kept.map((entry) => entry.row.id)).toEqual(['mejor'])
    expect(result.relevance.get('lejos')).toEqual({ cut: true, reason: 'similitud 0,300 < 0,370 (mejor 0,450 − 0,08), sin coincidencia explícita' })
    expect(result.summary).toEqual({ best: 0.45, threshold: 0.37, gap: 0.08 })
  })

  it('justo en el umbral se queda', () => {
    expect(kept([item({ id: 'mejor', semantic: 0.45 }), item({ id: 'borde', semantic: 0.37 })])).toEqual(['mejor', 'borde'])
  })

  it('una coincidencia explícita o el fijado por nombre se quedan aunque estén lejos', () => {
    const fused = [
      item({ id: 'mejor', semantic: 0.45 }),
      item({ id: 'categoria', semantic: 0.1, categories: ['pizzeria'] }),
      item({ id: 'tag', semantic: 0.1, tags: ['pizza'] }),
      item({ id: 'plato', semantic: 0.1, dishHas: [true] }),
      item({ id: 'keyword', semantic: 0.1, keyword: 0.2 }),
      item({ id: 'fijado', semantic: 0.1 }, true),
      item({ id: 'sin-embedding', semantic: null }),
    ]
    const result = relevanceCut(fused, { ...context, hasDishes: true })
    expect(result.cut).toEqual([])
    expect(['categoria', 'tag', 'plato', 'keyword', 'fijado', 'sin-embedding'].map((id) => result.relevance.get(id))).toEqual([
      { kept: 'category' },
      { kept: 'tag' },
      { kept: 'dish' },
      { kept: 'keyword' },
      { kept: 'pinned' },
      { kept: 'no-similarity' },
    ])
  })

  it('sin embedding de la consulta no corta nada', () => {
    const result = relevanceCut([item({ id: 'a', semantic: 0.45 }), item({ id: 'b', semantic: 0.1 })], { ...context, hasEmbedding: false })
    expect(result.kept).toHaveLength(2)
    expect(result.summary).toBeNull()
  })
})
