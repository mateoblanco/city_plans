import { describe, expect, it } from 'vitest'
import { pickWelcomePlaces, WELCOME_GRID } from '../pick'
import { welcomeKind, welcomePlace, type WelcomeRow } from '../places'

const row = (id: string, overrides: Partial<WelcomeRow> = {}): WelcomeRow => ({
  id,
  name: id,
  neighborhoodId: 'CORDON',
  categories: ['restaurant'],
  iconCategory: null,
  logoKey: null,
  logoBgColor: null,
  ...overrides,
})

/** Un random fijo (LCG) para que el sorteo se pueda repetir. */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32
  return seed / 2 ** 32
}

const kindOf = (item: { kind: string }) => item.kind
const pool = (kinds: Record<string, number>, hoods = 5) =>
  Object.entries(kinds).flatMap(([kind, count]) => Array.from({ length: count }, (_, n) => ({ id: `${kind}${n}`, kind, neighborhoodId: `H${n % hoods}` })))

describe('grilla de la bienvenida', () => {
  it('20 del pool, sin repetir', () => {
    const picked = pickWelcomePlaces(pool({ cafes: 20, bars: 15, eat: 15 }), kindOf, WELCOME_GRID, seeded(1))
    expect(picked).toHaveLength(20)
    expect(new Set(picked.map((item) => item.id)).size).toBe(20)
  })

  it('mezcla de tipos aunque el pool esté cargado de uno', () => {
    const picked = pickWelcomePlaces(pool({ eat: 40, cafes: 6, bars: 4 }), kindOf, WELCOME_GRID, seeded(2))
    const count = (kind: string) => picked.filter((item) => item.kind === kind).length
    expect(count('cafes')).toBe(6)
    expect(count('bars')).toBe(4)
    expect(count('eat')).toBe(10)
  })

  it('distintos barrios: dentro de cada tipo, primero los barrios que salieron menos', () => {
    const picked = pickWelcomePlaces(pool({ cafes: 10, bars: 10 }, 10), kindOf, 10, seeded(3))
    expect(new Set(picked.map((item) => item.neighborhoodId)).size).toBe(10)
  })

  it('al azar: otro random, otra mezcla', () => {
    const items = pool({ cafes: 20, bars: 15, eat: 15 })
    const ids = (seed: number) => pickWelcomePlaces(items, kindOf, WELCOME_GRID, seeded(seed)).map((item) => item.id)
    expect(ids(4)).not.toEqual(ids(5))
    expect(ids(4)).toEqual(ids(4))
  })

  it('con un pool más chico, todos', () => {
    expect(pickWelcomePlaces(pool({ cafes: 3, bars: 2 }), kindOf, WELCOME_GRID, seeded(6))).toHaveLength(5)
    expect(pickWelcomePlaces([], kindOf)).toEqual([])
  })
})

describe('card de la bienvenida', () => {
  it('logo, nombre y tipo (la categoría principal, en español)', () => {
    const place = welcomePlace(row('a', { name: 'Café Brasilero', categories: ['cafe', 'bakery'], logoBgColor: '#fff' }))
    expect(place).toMatchObject({ id: 'a', name: 'Café Brasilero', logoBgColor: '#fff' })
    expect(place.type).toBeTruthy()
    expect(place.type).not.toBe('cafe')
    expect(welcomePlace(row('b', { categories: [] })).type).toBeNull()
  })

  it('el tipo del sorteo sale del clasificador de los perfiles; sin tipo, aparte', () => {
    expect(welcomeKind(row('a', { categories: [] }))).toBe('other')
  })
})
