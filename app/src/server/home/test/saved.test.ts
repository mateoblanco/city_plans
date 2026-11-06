import { describe, expect, it } from 'vitest'
import type { CardRow } from '../../places/similar'
import { everyDay } from '../../search/test/fixtures'
import { assembleHomeWithSaved, type HomeRow } from '../assemble'
import { homeSavedRow, SAVED_ROW } from '../saved'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')

const card = (id: string, overrides: Partial<CardRow> = {}): CardRow => ({
  id,
  discounts: [],
  slug: id,
  name: id,
  neighborhoodId: 'POCITOS',
  categories: ['bar'],
  hours: everyDay('09:00', '23:00'),
  iconCategory: null,
  logoKey: null,
  logoBgColor: null,
  locatedIn: null,
  brandCount: 1,
  lat: -34.9,
  lng: -56.15,
  ...overrides,
})

/** La base sólo devuelve los publicados que existen (los demás no vienen), en cualquier orden. */
const deps = (published: CardRow[]) => {
  const calls: string[][] = []
  return {
    calls,
    async savedPlaces(ids: string[]) {
      calls.push(ids)
      return published.filter((row) => ids.includes(row.id)).reverse()
    },
  }
}

describe('homeSavedRow', () => {
  it('todos los guardados, en el orden de la cookie (más reciente primero), sin "Ver todos"', async () => {
    const row = await homeSavedRow(deps([card('a'), card('b'), card('c')]), ['c', 'a', 'b'], now)
    expect(row).toMatchObject({ id: SAVED_ROW.id, title: 'Guardados', href: null })
    expect(row!.places.map((place) => place.id)).toEqual(['c', 'a', 'b'])
  })

  it('ignora los que ya no existen o no están publicados', async () => {
    const row = await homeSavedRow(deps([card('a'), card('c')]), ['borrado', 'a', 'despublicado', 'c'], now)
    expect(row!.places.map((place) => place.id)).toEqual(['a', 'c'])
  })

  it('sin guardados (o si no queda ninguno) no hay fila, y sin ids no consulta', async () => {
    const empty = deps([card('a')])
    expect(await homeSavedRow(empty, [], now)).toBeNull()
    expect(empty.calls).toEqual([])
    expect(await homeSavedRow(deps([]), ['a', 'b'], now)).toBeNull()
  })

  it('sin filtrar por horario ni sacar cadenas, y sin tope de 8', async () => {
    const closed = card('cerrado', { hours: { slots: [], status: 'none' } })
    const chain = card('cadena', { brandCount: 12 })
    const many = Array.from({ length: 20 }, (_, index) => card(`x${index}`))
    const row = await homeSavedRow(deps([closed, chain, ...many]), ['cerrado', 'cadena', ...many.map((item) => item.id)], now)
    expect(row!.places).toHaveLength(22)
    expect(row!.places[0].openStatus.state).not.toBe('open')
    expect(row!.places[1].branchCount).toBe(12)
  })
})

describe('assembleHomeWithSaved', () => {
  const place = (id: string) => ({ id, branchCount: 1, branches: [] }) as unknown as HomeRow['places'][number]
  const homeRow = (id: string, ids: string[]): HomeRow => ({ id, title: id, places: ids.map(place), href: null })
  const ids = (rows: HomeRow[]) => rows.map((entry) => [entry.id, entry.places.map((item) => item.id)])

  it('"Guardados" va primero y sus lugares pueden repetirse en "Para vos" y en las filas siguientes', () => {
    const saved = homeRow('saved', ['a', 'b'])
    const rows = assembleHomeWithSaved(saved, [homeRow('for_you', ['a', 'c', 'd', 'e']), homeRow('lunch', ['b', 'f', 'g', 'h'])])
    expect(ids(rows)).toEqual([
      ['saved', ['a', 'b']],
      ['for_you', ['a', 'c', 'd', 'e']],
      ['lunch', ['b', 'f', 'g', 'h']],
    ])
  })

  it('con uno solo se muestra (no tiene mínimo), y sin guardados no hay fila', () => {
    expect(ids(assembleHomeWithSaved(homeRow('saved', ['a']), []))).toEqual([['saved', ['a']]])
    expect(ids(assembleHomeWithSaved(null, [homeRow('lunch', ['a', 'b', 'c', 'd'])]))).toEqual([['lunch', ['a', 'b', 'c', 'd']]])
  })
})
