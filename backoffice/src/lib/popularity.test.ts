import { describe, expect, it } from 'vitest'
import type { PopularityRow } from '@/types/popularity'
import { nextSort, originShares, sortPopularity } from './popularity'

const row = (name: string, patch: Partial<PopularityRow> = {}): PopularityRow => ({
  id: name, name, slug: name, views7: 0, views30: 0, saves7: 0, saves30: 0, directions7: 0, directions30: 0, origins: {}, homeRows: [], ...patch,
})

describe('popularidad', () => {
  it('ordena por cualquier total en los dos sentidos; a igual valor, por nombre', () => {
    const rows = [row('Bar', { views30: 3 }), row('Ávila', { views30: 3 }), row('Café', { views30: 9 })]
    expect(sortPopularity(rows, 'views30', 'desc').map((r) => r.name)).toEqual(['Café', 'Ávila', 'Bar'])
    expect(sortPopularity(rows, 'views30', 'asc').map((r) => r.name)).toEqual(['Ávila', 'Bar', 'Café'])
    expect(sortPopularity(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Ávila', 'Bar', 'Café'])
  })

  it('tocar la misma columna invierte; otra arranca de mayor a menor (nombre de la A a la Z)', () => {
    expect(nextSort({ sort: 'views30', direction: 'desc' }, 'views30')).toEqual({ sort: 'views30', direction: 'asc' })
    expect(nextSort({ sort: 'views30', direction: 'desc' }, 'saves7')).toEqual({ sort: 'saves7', direction: 'desc' })
    expect(nextSort({ sort: 'views30', direction: 'desc' }, 'name')).toEqual({ sort: 'name', direction: 'asc' })
  })

  it('orígenes con porcentaje, de más a menos', () => {
    expect(originShares({ home: 2, search: 1, similar: 1 })).toEqual([
      { origin: 'home', label: 'Home', count: 2, percent: 50 },
      { origin: 'search', label: 'Búsqueda', count: 1, percent: 25 },
      { origin: 'similar', label: 'Similares', count: 1, percent: 25 },
    ])
    expect(originShares({})).toEqual([])
  })
})
