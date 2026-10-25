import { describe, expect, it } from 'vitest'
import { collapseBranches } from '../branches'
import type { Fused } from '../fuse'
import { row } from './fixtures'

const item = (overrides: Parameters<typeof row>[0]): Fused => ({
  row: row(overrides), pinned: false, matchLevel: 'has', open: null, rrf: 0, boosts: {}, baseScore: 0, multiplier: 1, score: 0, positionWithoutQuality: 1,
})

// En orden de ranking: la mejor sucursal de Costa Azul es la de Pocitos.
const items = [
  item({ id: 'bar-tinto' }),
  item({ id: 'costa-pocitos', brandKey: 'costa-azul', neighborhoodId: 'POCITOS', distance: 3000 }),
  item({ id: 'otro' }),
  item({ id: 'costa-cordon', brandKey: 'costa-azul', neighborhoodId: 'CORDON', distance: 200 }),
  item({ id: 'costa-malvin', brandKey: 'costa-azul', neighborhoodId: 'MALVIN', distance: 900 }),
]
const shown = (context: { neighborhoods: string[]; near: boolean }) =>
  collapseBranches(items, context).map((entry) => [entry.row.id, entry.branches.map((branch) => branch.row.id)])

describe('collapseBranches', () => {
  it('sin barrio ni ubicación: la mejor rankeada, en su posición; los lugares sin marca no cambian', () => {
    expect(shown({ neighborhoods: [], near: false })).toEqual([
      ['bar-tinto', []],
      ['costa-pocitos', ['costa-cordon', 'costa-malvin']],
      ['otro', []],
    ])
  })

  it('con barrio: la de ese barrio aunque otra rankee mejor, en la posición de la mejor', () => {
    expect(shown({ neighborhoods: ['CORDON'], near: false })[1]).toEqual(['costa-cordon', ['costa-pocitos', 'costa-malvin']])
  })

  it('con barrio sin sucursal ahí, sigue la regla de ubicación o de ranking', () => {
    expect(shown({ neighborhoods: ['CENTRO'], near: true })[1][0]).toBe('costa-cordon')
    expect(shown({ neighborhoods: ['CENTRO'], near: false })[1][0]).toBe('costa-pocitos')
  })

  it('con ubicación: la más cercana', () => {
    expect(shown({ neighborhoods: [], near: true })[1]).toEqual(['costa-cordon', ['costa-pocitos', 'costa-malvin']])
  })
})
