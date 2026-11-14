import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../search/search'
import type { HomeRow } from '../assemble'
import { HOME_SECTIONS } from '../config'
import { layoutHome, type HomeParts } from '../layout'

// Montevideo es UTC−3. 12/10/2026 es lunes; 17/10/2026, sábado.
const mvd = (iso: string) => new Date(`${iso}:00-03:00`)

const open = (id: string, closesAt: string | null = null) =>
  ({ id, branchCount: 1, branches: [], openStatus: { state: 'open', closesAt, label: '', tone: 'open', prefix: '', status: 'Abierto', detail: null } }) as unknown as SearchResult
const closed = (id: string) => ({ ...open(id), openStatus: { ...open(id).openStatus, state: 'closed' } }) as SearchResult

/** Cada fila posible con 4 lugares propios abiertos (así ninguna se cae por repetidos). */
const cached = (): HomeRow[] =>
  HOME_SECTIONS.map((section) => ({ id: section.id, title: section.title, places: [0, 1, 2, 3].map((index) => open(`${section.id}-${index}`)), href: null }))

const parts = (now: Date, overrides: Partial<HomeParts> = {}): HomeParts => ({ saved: null, near: null, forYou: null, discounts: [], cached: cached(), since: now, ...overrides })
const rowIds = (rows: HomeRow[]) => rows.map((row) => row.id)
const fixedTail = ['world', 'classics', 'vegetarian', 'gluten_free']

describe('la home según la franja', () => {
  it('mañana: desayuno, especialidad y brunch; "Salida en pareja" al final', () => {
    const now = mvd('2026-10-12T08:30')
    expect(rowIds(layoutHome(parts(now), now))).toEqual(['breakfast', 'specialty_coffee', 'brunch', 'friends', ...fixedTail, 'couple'])
  })

  it('mediodía y tarde: amigos y después pareja', () => {
    const noon = mvd('2026-10-12T13:00')
    expect(rowIds(layoutHome(parts(noon), noon))).toEqual(['lunch', 'menu_of_the_day', 'quick', 'brunch', 'friends', 'couple', ...fixedTail])
    const afternoon = mvd('2026-10-12T17:00')
    expect(rowIds(layoutHome(parts(afternoon), afternoon))).toEqual(['coffee', 'shared_snack', 'friends', 'couple', ...fixedTail])
  })

  it('noche: pareja antes que amigos; After office lunes a viernes hasta las 21', () => {
    const monday = mvd('2026-10-12T20:30')
    expect(rowIds(layoutHome(parts(monday), monday))).toEqual(['dinner', 'drinks', 'after_office', 'couple', 'friends', ...fixedTail])
    const late = mvd('2026-10-12T21:00')
    expect(rowIds(layoutHome(parts(late), late))).not.toContain('after_office')
    const saturday = mvd('2026-10-17T20:00')
    expect(rowIds(layoutHome(parts(saturday), saturday))).not.toContain('after_office')
  })

  it('trasnoche: "Abierto ahora" sólo sin ubicación', () => {
    const now = mvd('2026-10-13T01:00')
    expect(rowIds(layoutHome(parts(now), now))).toEqual(['drinks', 'open_now', 'couple', 'friends', ...fixedTail])
    const near = { row: { id: 'near', title: 'Abierto ahora cerca tuyo', places: [], href: null }, meters: [] }
    expect(rowIds(layoutHome(parts(now, { near }), now))).not.toContain('open_now')
  })

  it('el orden completo: guardados, cerca tuyo, franja, para vos, descuentos, las de siempre', () => {
    const now = mvd('2026-10-12T17:00')
    const four = (prefix: string) => [0, 1, 2, 3].map((index) => open(`${prefix}${index}`))
    const nearPlaces = four('n')
    const result = layoutHome(
      parts(now, {
        saved: { id: 'saved', title: 'Guardados', places: four('s'), href: null },
        near: { row: { id: 'near', title: 'cerca', places: nearPlaces, href: null }, meters: nearPlaces.map((place, index) => ({ place, meters: index * 100 })) },
        forYou: { row: { id: 'for_you', title: 'Para vos', places: four('f'), href: null }, affinity: null },
        discounts: [{ id: 'discount:itau', title: 'Descuentos con Itaú', places: four('d'), href: null }],
      }),
      now,
    )
    expect(rowIds(result)).toEqual(['saved', 'near', 'coffee', 'shared_snack', 'for_you', 'discount:itau', 'friends', 'couple', ...fixedTail])
  })
})

describe('nada cerrado', () => {
  it('ninguna fila muestra cerrados ni los que cerraron desde que se buscó, salvo Guardados', () => {
    const since = mvd('2026-10-12T13:00')
    const now = mvd('2026-10-12T13:08')
    const rows = cached().map((row) => (row.id === 'lunch' ? { ...row, places: [...row.places, closed('lunch-closed'), open('lunch-gone', '13:05')] } : row))
    const saved = { id: 'saved', title: 'Guardados', places: [closed('s0'), closed('s1')], href: null }
    const forYou = { row: { id: 'for_you', title: 'Para vos', places: [open('f0'), open('f1'), open('f2'), open('f3'), closed('f4')], href: null }, affinity: null }
    const result = layoutHome(parts(now, { cached: rows, saved, forYou, since }), now)
    const all = result.filter((row) => row.id !== 'saved').flatMap((row) => row.places)
    expect(all.every((place) => place.openStatus.state === 'open')).toBe(true)
    expect(all.map((place) => place.id)).not.toContain('lunch-gone')
    // Guardados muestra todo, cerrados incluidos.
    expect(result[0].places.map((place) => place.id)).toEqual(['s0', 's1'])
  })
})

describe('orden personalizado dentro de las filas', () => {
  const now = mvd('2026-10-12T13:00')
  const pool = Array.from({ length: 30 }, (_, index) => open(`l${index}`))
  const withLunch = (places: SearchResult[]) => cached().map((row) => (row.id === 'lunch' ? { ...row, places } : row))
  const affinity = Object.fromEntries(pool.map((place) => [place.id, 0.7]))
  affinity.l9 = 0.95

  it('sin guardados el orden queda como el de la búsqueda', () => {
    const result = layoutHome(parts(now, { cached: withLunch(pool) }), now)
    expect(result.find((row) => row.id === 'lunch')!.places.map((place) => place.id)).toEqual(pool.slice(0, 8).map((place) => place.id))
  })

  it('con guardados sube lo que le gusta, y el primero sigue visible', () => {
    const forYou = { row: null, affinity }
    const lunch = layoutHome(parts(now, { cached: withLunch(pool), forYou }), now).find((row) => row.id === 'lunch')!.places.map((place) => place.id)
    expect(lunch).toContain('l9')
    expect(lunch[0]).toBe('l0')
  })

  it('excepciones: Guardados (más reciente primero), "Para vos" (ya personal) y cerca tuyo (manda la distancia)', () => {
    const four = (prefix: string) => [0, 1, 2, 3].map((index) => open(`${prefix}${index}`))
    const nearPlaces = four('n')
    const strong = { s3: 1, s0: 0, f3: 1, f0: 0, n3: 1, n0: 0, n1: 0.5, n2: 0.5 }
    const result = layoutHome(
      parts(now, {
        saved: { id: 'saved', title: 'Guardados', places: four('s'), href: null },
        near: { row: { id: 'near', title: 'cerca', places: nearPlaces, href: null }, meters: nearPlaces.map((place, index) => ({ place, meters: 100 + index * 400 })) },
        forYou: { row: { id: 'for_you', title: 'Para vos', places: four('f'), href: null }, affinity: strong },
      }),
      now,
    )
    const of = (id: string) => result.find((row) => row.id === id)!.places.map((place) => place.id)
    expect(of('saved')).toEqual(['s0', 's1', 's2', 's3'])
    expect(of('for_you')).toEqual(['f0', 'f1', 'f2', 'f3'])
    // Cada uno en su banda de 250 m: la afinidad no los cruza.
    expect(of('near')).toEqual(['n0', 'n1', 'n2', 'n3'])
  })
})
