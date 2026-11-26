import { describe, expect, it } from 'vitest'
import type { SearchResponse } from '@/server/search'
import { activeFilters, searchSummary } from '../search-analytics'

const response = (overrides: Partial<SearchResponse> = {}): SearchResponse =>
  ({
    query: 'pizza',
    interpreted: { chips: [] },
    bar: { intent: null, textIntent: null, subs: [], extras: [] },
    results: [{ id: 'p1' }, { id: 'p2' }],
    sections: null,
    forYou: null,
    relaxed: [],
    suggestedRemovals: [],
    location: { kind: 'all', reason: 'chosen' },
    near: null,
    nearby: null,
    nearbyOnly: null,
    resolvedBy: 'dictionary',
    ...overrides,
  }) as unknown as SearchResponse

const params = { query: 'pizza', filters: null, userLocation: null }

describe('searchSummary', () => {
  it('cerca mío: sólo que había ubicación y el tipo, nunca coordenadas ni radio', () => {
    const summary = searchSummary(
      response({ location: { kind: 'near', origin: { lat: -34.905, lng: -56.191 }, radiusM: 1500 }, near: { lat: -34.905, lng: -56.191 } }),
      { ...params, userLocation: '-34.905,-56.191' },
    )
    expect(summary).toEqual({
      query: 'pizza',
      query_normalized: 'pizza',
      tab: 'all',
      filters: { location: ['near'] },
      results_count: 2,
      resolved_by: 'dictionary',
      has_location: true,
    })
    const text = JSON.stringify(summary)
    expect(text).not.toMatch(/-34\.9|-56\.1|1500|lat|lng/)
  })

  it('sin coordenadas en la cookie (negado o salteado), has_location es false', () => {
    expect(searchSummary(response(), { ...params, userLocation: 'denied' }).has_location).toBe(false)
    expect(searchSummary(response(), { ...params, userLocation: 'skip' }).has_location).toBe(false)
    expect(searchSummary(response(), params).has_location).toBe(false)
  })

  it('zona del mapa: el tipo, sin los bordes', () => {
    const summary = searchSummary(response({ location: { kind: 'zone', bounds: { south: -34.92, west: -56.2, north: -34.9, east: -56.15 } } }), params)
    expect(summary.filters).toEqual({ location: ['zone'] })
    expect(JSON.stringify(summary)).not.toMatch(/-34\.92|-56\.2/)
  })

  it('recorta el texto a 100 caracteres y suma los de "Cerca de"', () => {
    const nearby = { title: 'Cerca de Palermo', label: 'Palermo', total: 6, results: [] }
    const summary = searchSummary(response({ nearby }), { ...params, query: 'x'.repeat(130) })
    expect(summary.query).toHaveLength(100)
    expect(summary.query_normalized).toHaveLength(100)
    expect(summary.results_count).toBe(8)
  })

  it('el texto normalizado: minúsculas, sin tildes ni espacios de más; el original queda tal cual', () => {
    const summary = searchSummary(response(), { ...params, query: '  Café   TRANQUILO en Cordón ' })
    expect(summary.query).toBe('  Café   TRANQUILO en Cordón ')
    expect(summary.query_normalized).toBe('cafe tranquilo en cordon')
    expect(searchSummary(response(), { ...params, query: 'Ñoquis del Año' }).query_normalized).toBe('noquis del ano')
    expect(searchSummary(response(), { ...params, query: '' }).query_normalized).toBe('')
  })

  it('la intención activa y quién interpretó el texto', () => {
    const bar = { intent: { id: 'bars', fromText: true }, textIntent: 'bars', subs: [], extras: [] }
    const summary = searchSummary(response({ bar, resolvedBy: 'llm' } as Partial<SearchResponse>), params)
    expect(summary.tab).toBe('bars')
    expect(summary.resolved_by).toBe('llm')
  })
})

describe('activeFilters', () => {
  it('barrios, precio, dieta, horario, descuentos, sub-filtros y extras de la URL', () => {
    const filters = activeFilters(
      response({
        location: { kind: 'neighborhood' },
        interpreted: {
          chips: [
            { kind: 'neighborhood', id: 'CORDON', label: 'Cordón' },
            { kind: 'price', id: 'low', label: 'Accesible' },
            { kind: 'diet', id: 'vegan', label: 'Vegano' },
            { kind: 'openAt', id: 'now', label: 'Abierto ahora' },
          ],
        },
        bar: {
          intent: { id: 'bars', fromText: false },
          textIntent: null,
          subs: [
            { id: 'cocktails', label: 'Tragos', active: true, fromText: false, removeKeys: [] },
            { id: 'beer', label: 'Cerveza', active: false, fromText: false, removeKeys: [] },
          ],
          extras: [
            { kind: 'tag', id: 'groups', label: 'Con amigos', fromFilter: true },
            { kind: 'dish', id: 'pizza', label: 'pizza', fromText: true },
          ],
        },
      } as Partial<SearchResponse>),
      { filters: 'neighborhood:CORDON,discount:itau.credit,discount:bbva.debit' },
    )
    expect(filters).toEqual({
      location: ['neighborhood:CORDON'],
      price: ['low'],
      diet: ['vegan'],
      open: ['now'],
      discount: ['itau.credit', 'bbva.debit'],
      sub: ['cocktails'],
      extra: ['tag:groups'],
    })
  })
})
