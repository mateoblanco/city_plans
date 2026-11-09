import { describe, expect, it } from 'vitest'
import { SECTIONS } from '@shared/sections.ts'
import { parseFilters } from '../../search/filters'
import { parseIntent } from '../../search/intents'
import type { CandidateRow } from '../../search/candidates'
import type { SearchResult } from '../../search/search'
import { everyDay, fakeCache, fakeStore, row } from '../../search/test/fixtures'
import { assembleHome, type HomeRow } from '../assemble'
import { HOME_SECTIONS, homeSearchUrl } from '../config'
import { homeForYouRow, homeSectionRows } from '../rows'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')

const place = (id: string, overrides: Partial<SearchResult> = {}) => ({ id, branchCount: 1, branches: [], ...overrides }) as SearchResult
const homeRow = (id: string, ids: string[], overrides: Partial<SearchResult> = {}): HomeRow => ({ id, title: id, places: ids.map((placeId) => place(placeId, overrides)), href: null })
const ids = (rows: HomeRow[]) => rows.map((entry) => [entry.id, entry.places.map((item) => item.id)])

describe('config de la home', () => {
  it('cada fila es una búsqueda sin texto que pasa entera por los filtros de la URL ("Ver todos" busca lo mismo)', () => {
    for (const section of HOME_SECTIONS) {
      const url = homeSearchUrl(section.search)
      expect(url.q).toBe('')
      const filters = parseFilters(url.f)
      expect(filters.diet).toEqual(section.search.diet ?? [])
      expect(filters.tags).toEqual(section.search.tags ?? [])
      expect(filters.section).toBe(section.search.section ?? null)
      expect(parseIntent(url.intent, url.sub)).toEqual({ intent: section.search.intent ?? null, subs: section.search.sub ?? [] })
      // Todas las filas son "Abre hoy", así el "Ver todos" muestra lo mismo.
      expect(filters.opensToday).toBe(true)
    }
  })

  it('orden fijo, y "Comidas del mundo" es el grupo "Comida del mundo" de la búsqueda', () => {
    expect(HOME_SECTIONS.map((section) => section.title)).toEqual(['Para almorzar', 'Lugares para brunchear', 'Para tomar algo', 'Comidas del mundo', 'Clásicos uruguayos', 'Vegetariano', 'Merienda', 'Sin TACC'])
    expect(HOME_SECTIONS.find((section) => section.id === 'world')?.search).toEqual({ section: 'world' })
    expect(SECTIONS.world.title.es).toBe('Comida del mundo')
    // Brunch por tag y no por sub-filtro: es sub de Comer y de Cafés, y así entran los dos.
    expect(HOME_SECTIONS.find((section) => section.id === 'brunch')?.search).toEqual({ tags: ['brunch'] })
  })
})

describe('assembleHome', () => {
  const range = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`)

  it('hasta 8 por fila, sin repetir lo de las filas anteriores, en el orden de su búsqueda', () => {
    const rows = assembleHome([homeRow('a', range('x', 10)), homeRow('b', [...range('x', 4), ...range('y', 5)])])
    // x8 y x9 no salieron en a (tope de 8): b los puede mostrar.
    const rows2 = assembleHome([homeRow('a', range('x', 10)), homeRow('b', ['x9', ...range('x', 4), ...range('y', 3)])])
    expect(ids(rows)).toEqual([['a', range('x', 8)], ['b', range('y', 5)]])
    expect(ids(rows2)).toEqual([['a', range('x', 8)], ['b', ['x9', 'y0', 'y1', 'y2']]])
  })

  it('con menos de 4 no se muestra, y sus lugares quedan para las siguientes', () => {
    const rows = assembleHome([homeRow('a', range('x', 8)), homeRow('b', [...range('x', 8), 'y0', 'y1', 'y2']), homeRow('c', ['y0', 'y1', 'y2', 'y3'])])
    expect(ids(rows)).toEqual([['a', range('x', 8)], ['c', ['y0', 'y1', 'y2', 'y3']]])
  })

  it('sin cadenas (4 sucursales o más) y sin otra card que esconde una sucursal ya mostrada', () => {
    const chain = homeRow('a', ['big'], { branchCount: 4 }).places[0]
    const branchOfShown = place('z', { branches: [{ id: 'x0', lat: 0, lng: 0 }] })
    const rows = assembleHome([homeRow('a', range('x', 4)), { ...homeRow('b', range('y', 4)), places: [chain, branchOfShown, ...homeRow('b', range('y', 4)).places] }])
    expect(ids(rows)).toEqual([['a', range('x', 4)], ['b', range('y', 4)]])
  })

  it('"Para vos" va primero y lo que muestra no se repite abajo', () => {
    const rows = assembleHome([homeRow('for_you', ['x0', 'x1', 'x2', 'x3']), homeRow('lunch', range('x', 9))])
    expect(ids(rows)).toEqual([['for_you', ['x0', 'x1', 'x2', 'x3']], ['lunch', range('x', 9).slice(4)]])
  })
})

describe('búsquedas de la home', () => {
  const places = [
    ...Array.from({ length: 6 }, (_, index) => row({ id: `r${index}`, categories: ['restaurant'], tags: ['lunch', 'japanese'], diet: { vegan: 'unknown', vegetarian: 'fully', glutenFree: 'has_options' } })),
    ...Array.from({ length: 6 }, (_, index) => row({ id: `b${index}`, categories: ['bar'], tags: ['drinks'] })),
    ...Array.from({ length: 6 }, (_, index) => row({ id: `c${index}`, categories: ['cafe'], iconCategory: 'coffee', tags: ['afternoon_snack'] })),
    ...Array.from({ length: 6 }, (_, index) => row({ id: `g${index}`, categories: ['grill'], iconCategory: 'grill' })),
  ]

  it('nunca llaman al modelo ni al embedding, y cada fila trae lo de su búsqueda con su "Ver todos"', async () => {
    const { store } = fakeStore(places)
    const { cache, interpreted, embedded } = fakeCache()
    const rows = await homeSectionRows({ store, cache }, now)
    expect(interpreted).toEqual([])
    expect(embedded).toEqual([])
    const of = (id: string) => rows.find((entry) => entry.id === id)!
    expect(of('lunch').places.map((item) => item.id).sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'])
    expect(of('drinks').places.every((item) => item.id.startsWith('b'))).toBe(true)
    expect(of('snack').places.map((item) => item.id).sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5'])
    expect(of('classics').places.map((item) => item.id).sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5'])
    expect(of('vegetarian').places.every((item) => item.id.startsWith('r'))).toBe(true)
    expect(of('lunch').href).toBe('/search?intent=eat&sub=lunch&f=open%3Atoday')
    expect(of('snack').href).toBe('/search?f=open%3Atoday%2Ctag%3Aafternoon_snack')
    expect(of('world').href).toBe('/search?f=open%3Atoday%2Csection%3Aworld')
  })

  it('sólo lugares abiertos ahora o que abren más tarde hoy (los sin horario, como en "Abre hoy", entran al final)', async () => {
    // Lunes 13:00: open abierto ahora, later abre a las 20:00, closed cerró a las 12:00 y no vuelve a abrir hoy.
    const bar = (id: string, hours: CandidateRow['hours']) => row({ id, categories: ['bar'], tags: ['drinks'], hours })
    const { store } = fakeStore([
      bar('closed', { slots: [{ day: 1, opens: '08:00', closes: '12:00' }], status: 'exact' }),
      bar('open', everyDay('12:00', '23:00')),
      bar('later', { slots: [{ day: 1, opens: '20:00', closes: '23:59' }], status: 'exact' }),
      bar('unknown', { slots: [], status: 'none' }),
    ])
    const rows = await homeSectionRows({ store, cache: fakeCache().cache }, now)
    const drinks = rows.find((entry) => entry.id === 'drinks')!.places.map((item) => item.id)
    expect(drinks).not.toContain('closed')
    expect(drinks.slice(0, 2).sort()).toEqual(['later', 'open'])
    expect(drinks.at(-1)).toBe('unknown')
  })

  it('si nada abre hoy, la búsqueda suelta el horario: la fila queda vacía (y no sale) en vez de mostrar cerrados', async () => {
    const closed = Array.from({ length: 6 }, (_, index) => row({ id: `b${index}`, categories: ['bar'], tags: ['drinks'], hours: { slots: [{ day: 1, opens: '08:00', closes: '12:00' }], status: 'exact' } }))
    const rows = await homeSectionRows({ store: fakeStore(closed).store, cache: fakeCache().cache }, now)
    expect(rows.find((entry) => entry.id === 'drinks')!.places).toEqual([])
  })

  it('"Para vos": sin likes no busca', async () => {
    const { store, calls } = fakeStore(places)
    expect(await homeForYouRow({ store, cache: fakeCache().cache }, [], now)).toBeNull()
    expect(calls).toEqual([])
  })

  it('"Para vos" busca con "Abre hoy", como las demás filas', async () => {
    const { store, calls } = fakeStore(places)
    await homeForYouRow({ store, cache: fakeCache().cache }, ['r0', 'r1'], now)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.filters.openAt?.today)).toBe(true)
  })
})
