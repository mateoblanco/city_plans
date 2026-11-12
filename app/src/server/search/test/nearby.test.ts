import { describe, expect, it } from 'vitest'
import polygons from '@shared/neighborhood-polygons.json'
import { NEIGHBORHOOD_NAMES } from '@shared/neighborhood-names.ts'
import type { Collapsed } from '../branches'
import { emptyInterpretation } from '../interpretation'
import { emptyNeighborhoodNotice, nearbyFilterFor, nearbyTitle, orderNearby } from '../nearby'
import { canRelax, relax, RELAX_ORDER, type SearchState } from '../relax'
import { row } from './fixtures'

const item = (overrides: Parameters<typeof row>[0], matchLevel: 'has' | 'maybe' = 'has'): Collapsed => ({
  row: row(overrides), pinned: false, matchLevel, dishLevel: matchLevel, open: null, rrf: 0, boosts: {}, baseScore: 0, multiplier: 1, score: 0, positionWithoutQuality: 1, branches: [],
})

describe('polígonos', () => {
  it('cada barrio del catálogo tiene su anillo cerrado', () => {
    const rings = polygons as Record<string, number[][]>
    for (const id of Object.keys(NEIGHBORHOOD_NAMES)) {
      const ring = rings[id]
      expect(ring, id).toBeDefined()
      expect(ring.length, id).toBeGreaterThanOrEqual(4)
      expect(ring[0], id).toEqual(ring.at(-1))
    }
  })

  it('el filtro: excluye los barrios pedidos y lleva un GeoJSON por cada uno', () => {
    const filter = nearbyFilterFor(['PALERMO', 'CORDON'])!
    expect(filter.exclude).toEqual(['PALERMO', 'CORDON'])
    expect(filter.radiusM).toBe(500)
    expect(filter.polygons.map((polygon) => JSON.parse(polygon).type)).toEqual(['Polygon', 'Polygon'])
    expect(nearbyFilterFor([])).toBeNull()
    expect(nearbyFilterFor(['NARNIA'])).toBeNull()
  })
})

describe('textos', () => {
  it('título y aviso con uno o varios barrios', () => {
    expect(nearbyTitle(['PALERMO'])).toBe('Cerca de Palermo')
    expect(nearbyTitle(['PALERMO', 'CORDON', 'BARRIO SUR'])).toBe('Cerca de Palermo, Cordón y Barrio Sur')
    expect(emptyNeighborhoodNotice(['PALERMO'])).toEqual({ what: 'neighborhood', message: 'No encontramos en Palermo; estos están cerca.' })
  })
})

describe('orderNearby', () => {
  it('"has" antes que "maybe" y, en cada nivel, por distancia al borde (a igual distancia, el ranking)', () => {
    const items = [
      item({ id: 'maybe-cerca', edgeDistance: 10 }, 'maybe'),
      item({ id: 'has-lejos', edgeDistance: 450 }),
      item({ id: 'has-a', edgeDistance: 100 }),
      item({ id: 'has-b', edgeDistance: 100 }),
      item({ id: 'maybe-lejos', edgeDistance: 300 }, 'maybe'),
    ]
    expect(orderNearby(items, []).map((entry) => entry.row.id)).toEqual(['has-a', 'has-b', 'has-lejos', 'maybe-cerca', 'maybe-lejos'])
  })

  it('sin lo que ya salió en el barrio: el lugar, una sucursal escondida o la marca', () => {
    const shown = [{ ...item({ id: 'en-barrio', brandKey: 'club' }), branches: [item({ id: 'sucursal' })] }]
    const items = [item({ id: 'en-barrio', edgeDistance: 1 }), item({ id: 'sucursal', edgeDistance: 2 }), item({ id: 'otra-club', brandKey: 'club', edgeDistance: 3 }), item({ id: 'nuevo', edgeDistance: 4 })]
    expect(orderNearby(items, shown).map((entry) => entry.row.id)).toEqual(['nuevo'])
  })
})

describe('el barrio nunca se relaja', () => {
  const state = (must: Partial<SearchState['interpretation']['must']>): SearchState => {
    const value = emptyInterpretation()
    return { interpretation: { ...value, must: { ...value.must, ...must } }, dishMode: 'dish', nearRadius: null, intent: null, subs: [] }
  }

  it('no hay paso de barrio y el último recurso lo conserva', () => {
    expect(RELAX_ORDER).not.toContain('neighborhood')
    const relaxed = relax(state({ neighborhoods: ['PALERMO'], categories: ['cafe'], price: ['low'] }), 'similarity')
    expect(relaxed.interpretation.must).toMatchObject({ neighborhoods: ['PALERMO'], categories: [], price: [] })
  })

  it('el barrio solo no habilita el último recurso', () => {
    expect(canRelax(state({ neighborhoods: ['PALERMO'] }), 'similarity', [])).toBe(false)
    expect(canRelax(state({ neighborhoods: ['PALERMO'], price: ['low'] }), 'similarity', [])).toBe(true)
  })
})
