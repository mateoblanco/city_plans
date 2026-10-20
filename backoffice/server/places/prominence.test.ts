import { describe, expect, it } from 'vitest'
import { computeProminence } from './prominence.ts'

describe('computeProminence', () => {
  it('sin dato de Instagram (o sucursal de cadena) es neutro', () => {
    expect(computeProminence({ igFollowers: null })).toBe(0.5)
  })

  it('log10(seguidores + 1) / 5', () => {
    expect(computeProminence({ igFollowers: 0 })).toBe(0)
    expect(computeProminence({ igFollowers: 999 })).toBeCloseTo(0.6)
    expect(computeProminence({ igFollowers: 99_999 })).toBeCloseTo(1)
  })

  it('topea en 1', () => {
    expect(computeProminence({ igFollowers: 5_000_000 })).toBe(1)
  })

  it('una sucursal de cadena usa los seguidores de la marca, descontados', () => {
    expect(computeProminence({ igFollowers: 999, chainBranch: true })).toBeCloseTo(0.6 * 0.85)
    expect(computeProminence({ igFollowers: null, chainBranch: true })).toBe(0.5)
  })

  it('sin dato es mejor que 0 seguidores y peor que muchos', () => {
    const none = computeProminence({ igFollowers: null })
    expect(computeProminence({ igFollowers: 0 })).toBeLessThan(none)
    expect(computeProminence({ igFollowers: 50_000 })).toBeGreaterThan(none)
  })
})
