import { describe, expect, it } from 'vitest'
import { computeProminence } from './prominence.ts'

describe('computeProminence', () => {
  it('sin señales vale sólo el término neutro de Instagram', () => {
    expect(computeProminence({ editorialMentions: 0, listedOrAwarded: false, igFollowers: null })).toBeCloseTo(0.125)
  })

  it('llega a 1 con los topes alcanzados y no se pasa', () => {
    expect(computeProminence({ editorialMentions: 5, listedOrAwarded: true, igFollowers: 99_999 })).toBeCloseTo(1)
    expect(computeProminence({ editorialMentions: 12, listedOrAwarded: true, igFollowers: 5_000_000 })).toBe(1)
  })

  it('sin dato de Instagram es mejor que 0 seguidores y peor que muchos', () => {
    const base = { editorialMentions: 2, listedOrAwarded: false }
    const none = computeProminence({ ...base, igFollowers: null })
    expect(computeProminence({ ...base, igFollowers: 0 })).toBeLessThan(none)
    expect(computeProminence({ ...base, igFollowers: 50_000 })).toBeGreaterThan(none)
  })

  it('suma cada término con su peso', () => {
    // 0.6 × 1/2 + 0.25 × log10(1000)/5 + 0.15
    expect(computeProminence({ editorialMentions: 1, listedOrAwarded: true, igFollowers: 999 })).toBeCloseTo(0.3 + 0.15 + 0.15)
    // Desde 2 menciones el término editorial ya está al tope.
    expect(computeProminence({ editorialMentions: 3, listedOrAwarded: false, igFollowers: null }))
      .toBe(computeProminence({ editorialMentions: 2, listedOrAwarded: false, igFollowers: null }))
  })
})
