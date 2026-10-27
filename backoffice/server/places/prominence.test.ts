import { describe, expect, it } from 'vitest'
import { computeProminence, IG_NEUTRAL, medianIgTerm } from './prominence.ts'

// Lo que vale un lugar sin seguidores en estas pruebas.
const MEDIAN = 0.85

describe('computeProminence', () => {
  it('un lugar sin Instagram toma la mediana de los que sí tienen', () => {
    expect(computeProminence({ igFollowers: null }, MEDIAN)).toBe(MEDIAN)
  })

  it('una sucursal de cadena sin seguidores también toma la mediana, sin el ×0,85', () => {
    expect(computeProminence({ igFollowers: null, chainBranch: true }, MEDIAN)).toBe(MEDIAN)
  })

  it('con seguidores no cambia: log10(seguidores + 1) / 5, sin importar la mediana', () => {
    expect(computeProminence({ igFollowers: 0 }, MEDIAN)).toBe(0)
    expect(computeProminence({ igFollowers: 999 }, MEDIAN)).toBeCloseTo(0.6)
    expect(computeProminence({ igFollowers: 999 }, 0.2)).toBeCloseTo(0.6)
    expect(computeProminence({ igFollowers: 99_999 }, MEDIAN)).toBeCloseTo(1)
  })

  it('topea en 1', () => {
    expect(computeProminence({ igFollowers: 5_000_000 }, MEDIAN)).toBe(1)
  })

  it('una sucursal de cadena usa los seguidores de la marca, descontados', () => {
    expect(computeProminence({ igFollowers: 999, chainBranch: true }, MEDIAN)).toBeCloseTo(0.6 * 0.85)
  })
})

describe('medianIgTerm', () => {
  it('mediana del término de Instagram, ignorando los null', () => {
    expect(medianIgTerm([999, null, 9, 99_999])).toBeCloseTo(0.6)
    expect(medianIgTerm([9, 999, null, 99_999, 99])).toBeCloseTo(0.5)
  })

  it('con cantidad par promedia los dos del medio', () => {
    expect(medianIgTerm([9, 999])).toBeCloseTo(0.4)
  })

  it('sin ningún lugar con seguidores cae en 0,5', () => {
    expect(medianIgTerm([])).toBe(IG_NEUTRAL)
    expect(medianIgTerm([null, null])).toBe(IG_NEUTRAL)
  })
})
