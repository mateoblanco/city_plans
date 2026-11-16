import { describe, expect, it } from 'vitest'
import { SECTIONS } from '@shared/sections.ts'
import { findDef, label } from '@shared/tags.ts'
import { parseFilters } from '../../search/filters'
import { parseIntent } from '../../search/intents'
import type { CandidateRow } from '../../search/candidates'
import type { SearchResult } from '../../search/search'
import { everyDay, fakeCache, fakeStore, row } from '../../search/test/fixtures'
import { assembleHome, type HomeRow } from '../assemble'
import { fixedSections, HOME_CONFIG, HOME_SECTIONS, homeSearchUrl, homeViewAllUrl, SLOT_SECTIONS } from '../config'
import { searchHref } from '@/components/pages/SearchPage/utils/search-href'
import { interpretWithDictionary } from '../../search/dictionary'
import { showsInBar } from '../../search/labels'
import { normalizeQuery } from '../../search/normalize'
import { homeForYouRow, homeSectionRows } from '../rows'
import { homeSlot, nextSlotStart, parseSlotKey, slotKey } from '../slots'
import { runSearch } from '../../search/search'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')

const place = (id: string, overrides: Partial<SearchResult> = {}) => ({ id, branchCount: 1, branches: [], ...overrides }) as SearchResult
const homeRow = (id: string, ids: string[], overrides: Partial<SearchResult> = {}): HomeRow => ({ id, title: id, places: ids.map((placeId) => place(placeId, overrides)), href: null })
const ids = (rows: HomeRow[]) => rows.map((entry) => [entry.id, entry.places.map((item) => item.id)])
const titles = (defs: { title: string }[]) => defs.map((def) => def.title)

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
      // Fila y "Ver todos": "Abierto ahora" en todo Montevideo.
      expect(filters.opensNow).toBe(true)
      expect(url.loc).toBe('all')
    }
  })

  it('tabla fila → destino del "Ver todos": intención y sub o el nombre de la fila, siempre con open:now y loc=all', () => {
    const open = { f: 'open:now', loc: 'all' }
    const expected: Record<string, Record<string, string>> = {
      breakfast: { intent: 'eat', sub: 'breakfast', ...open },
      specialty_coffee: { intent: 'cafes', sub: 'specialty', ...open },
      brunch: { intent: 'eat', sub: 'brunch', ...open },
      lunch: { intent: 'eat', sub: 'lunch', ...open },
      menu_of_the_day: { q: 'Menú del día', ...open },
      quick: { q: 'Algo rápido', intent: 'eat', ...open },
      coffee: { intent: 'cafes', ...open },
      shared_snack: { q: 'Merienda para 2', ...open },
      dinner: { intent: 'eat', sub: 'dinner', ...open },
      drinks: { intent: 'bars', ...open },
      after_office: { q: 'After office', ...open },
      open_now: open,
      friends: { q: 'Juntada con amigos', ...open },
      couple: { q: 'Salida en pareja', ...open },
      // Sin par en la barra ni frase: quedan con su chip (grupo) o en Dieta.
      world: { f: 'open:now,section:world', loc: 'all' },
      classics: { f: 'open:now,section:classics', loc: 'all' },
      vegetarian: { f: 'open:now,diet:vegetarian', loc: 'all' },
      gluten_free: { f: 'open:now,diet:glutenFree', loc: 'all' },
    }
    const actual = Object.fromEntries(
      HOME_SECTIONS.map((section) => [section.id, Object.fromEntries(new URL(searchHref(homeViewAllUrl(section.search)), 'http://x').searchParams)]),
    )
    expect(actual).toEqual(expected)
  })

  it('el texto de cada "Ver todos" es una frase de fila del diccionario con los mismos tags (sin modelo)', () => {
    for (const section of HOME_SECTIONS.filter((item) => item.search.text)) {
      const value = interpretWithDictionary(normalizeQuery(section.search.text!))
      expect(value?.rowPhrase, section.id).toBe(true)
      expect(value?.must.tags, section.id).toEqual(section.search.tags)
      // Los tags van todos en el texto: el "Ver todos" no los repite en f.
      expect(parseFilters(homeViewAllUrl(section.search).f).tags, section.id).toEqual([])
    }
  })

  it('las filas de cada franja', () => {
    expect(titles(SLOT_SECTIONS.morning)).toEqual(['Para desayunar', 'Café de especialidad', 'Brunch'])
    expect(titles(SLOT_SECTIONS.midday)).toEqual(['Para almorzar', 'Menú del día', 'Algo rápido', 'Brunch'])
    expect(titles(SLOT_SECTIONS.afternoon)).toEqual(['Para tomar un café', 'Merienda para 2'])
    expect(titles(SLOT_SECTIONS.night)).toEqual(['Para cenar', 'Para tomar algo', 'After office'])
    expect(titles(SLOT_SECTIONS.late)).toEqual(['Para tomar algo', 'Abierto ahora'])
    // Brunch y Desayuno: el sub de Comer, donde manda el tag (también entran los cafés).
    expect(SLOT_SECTIONS.morning.find((section) => section.id === 'brunch')?.search).toEqual({ intent: 'eat', sub: ['brunch'] })
    expect(SLOT_SECTIONS.morning.find((section) => section.id === 'breakfast')?.search).toEqual({ intent: 'eat', sub: ['breakfast'] })
    expect(SLOT_SECTIONS.afternoon.find((section) => section.id === 'shared_snack')?.search).toEqual({ tags: ['shared_afternoon_tea'], text: 'Merienda para 2' })
    // Ya no están las filas fijas que pasaron a las franjas.
    expect(HOME_SECTIONS.map((section) => section.title)).not.toContain('Merienda')
    expect(HOME_SECTIONS.map((section) => section.title)).not.toContain('Lugares para brunchear')
  })

  it('las de siempre: de noche "Salida en pareja" antes, a la mañana al final', () => {
    const rest = ['Comidas del mundo', 'Clásicos uruguayos', 'Vegetariano', 'Sin TACC']
    expect(titles(fixedSections('midday'))).toEqual(['Juntada con amigos', 'Salida en pareja', ...rest])
    expect(titles(fixedSections('afternoon'))).toEqual(['Juntada con amigos', 'Salida en pareja', ...rest])
    expect(titles(fixedSections('night'))).toEqual(['Salida en pareja', 'Juntada con amigos', ...rest])
    expect(titles(fixedSections('late'))).toEqual(['Salida en pareja', 'Juntada con amigos', ...rest])
    expect(titles(fixedSections('morning'))).toEqual(['Juntada con amigos', ...rest, 'Salida en pareja'])
    expect(fixedSections('midday').find((section) => section.id === 'world')?.search).toEqual({ section: 'world' })
    expect(SECTIONS.world.title.es).toBe('Comida del mundo')
  })

  it('After office: sólo de lunes a viernes y hasta las 21', () => {
    const when = SLOT_SECTIONS.night.find((section) => section.id === 'after_office')!.when!
    const at = (day: number, time: string) => when({ day, time, near: false })
    expect(at(1, '19:00')).toBe(true)
    expect(at(5, '20:59')).toBe(true)
    expect(at(5, '21:00')).toBe(false)
    expect(at(6, '20:00')).toBe(false)
    expect(at(0, '20:00')).toBe(false)
  })

  it('"Abierto ahora" de trasnoche sólo sin "cerca tuyo"', () => {
    const when = SLOT_SECTIONS.late.find((section) => section.id === 'open_now')!.when!
    expect(when({ day: 1, time: '01:00', near: false })).toBe(true)
    expect(when({ day: 1, time: '01:00', near: true })).toBe(false)
  })

  it('"Merienda para 2": mismo id y sinónimos, más "merienda para dos"', () => {
    expect(label('shared_afternoon_tea', 'es')).toBe('Merienda para 2')
    expect(findDef('shared_afternoon_tea')?.synonyms.es).toEqual(expect.arrayContaining(['merienda para dos', 'merienda para compartir']))
  })
})

describe('franjas (hora de Montevideo)', () => {
  it('cada límite es de la franja que empieza', () => {
    expect(homeSlot('00:00')).toBe('late')
    expect(homeSlot('05:59')).toBe('late')
    expect(homeSlot('06:00')).toBe('morning')
    expect(homeSlot('10:59')).toBe('morning')
    expect(homeSlot('11:00')).toBe('midday')
    expect(homeSlot('14:59')).toBe('midday')
    expect(homeSlot('15:00')).toBe('afternoon')
    expect(homeSlot('18:59')).toBe('afternoon')
    expect(homeSlot('19:00')).toBe('night')
    expect(homeSlot('23:59')).toBe('night')
  })
})

describe('clave de la caché por franja', () => {
  const mvd = (iso: string) => new Date(`${iso}:00-03:00`)

  it('fecha y franja de Montevideo: cambia justo en cada borde, también a la medianoche', () => {
    expect(slotKey(mvd('2026-11-16T18:59'))).toBe('2026-11-16|afternoon')
    expect(slotKey(mvd('2026-11-16T19:00'))).toBe('2026-11-16|night')
    expect(slotKey(mvd('2026-11-16T23:59'))).toBe('2026-11-16|night')
    expect(slotKey(mvd('2026-11-17T00:00'))).toBe('2026-11-17|late')
    expect(slotKey(mvd('2026-11-17T06:00'))).toBe('2026-11-17|morning')
    expect(parseSlotKey('2026-11-16|night')).toEqual({ slot: 'night', start: mvd('2026-11-16T19:00') })
  })

  it('la franja siguiente (para precalentarla)', () => {
    expect(nextSlotStart(mvd('2026-11-16T18:52'))).toEqual(mvd('2026-11-16T19:00'))
    expect(nextSlotStart(mvd('2026-11-16T23:55'))).toEqual(mvd('2026-11-17T00:00'))
    expect(nextSlotStart(mvd('2026-11-17T03:00'))).toEqual(mvd('2026-11-17T06:00'))
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
})

describe('assembleHome: los logos de la card "Ver todos" (more)', () => {
  const range = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index}`)
  const withHref = (row: HomeRow): HomeRow => ({ ...row, href: `/search?${row.id}` })
  const more = (rows: HomeRow[], id: string) => rows.find((entry) => entry.id === id)!.more!.map((logo) => logo.id)

  it('los 3 siguientes a los 8 que se ven, con nombre y logo del pool', () => {
    const pool = withHref(homeRow('a', range('x', 12)))
    pool.places[8] = { ...pool.places[8], name: 'Lugar 8', logoUrl: 'https://logos/x8.png', logoBgColor: '#000' }
    const [row] = assembleHome([pool])
    expect(row.places.map((item) => item.id)).toEqual(range('x', 8))
    expect(row.more).toEqual([
      { id: 'x8', name: 'Lugar 8', logoUrl: 'https://logos/x8.png', logoBgColor: '#000' },
      { id: 'x9', name: undefined, logoUrl: undefined, logoBgColor: undefined },
      { id: 'x10', name: undefined, logoUrl: undefined, logoBgColor: undefined },
    ])
    expect(HOME_CONFIG.viewAllLogos).toBe(3)
  })

  it('con menos de 3 extras, los que haya; si la fila ya muestra todo, ninguno', () => {
    expect(more(assembleHome([withHref(homeRow('a', range('x', 10)))]), 'a')).toEqual(['x8', 'x9'])
    expect(more(assembleHome([withHref(homeRow('a', range('x', 8)))]), 'a')).toEqual([])
    expect(more(assembleHome([withHref(homeRow('a', range('x', 5)))]), 'a')).toEqual([])
  })

  it('sólo en las filas con "Ver todos" (href): "Para vos" no tiene', () => {
    expect(more(assembleHome([homeRow('for_you', range('x', 12))]), 'for_you')).toEqual([])
  })

  it('mismas reglas que la fila: sin cadenas, sin lo de filas anteriores ni sucursales de lo que ya se ve', () => {
    const first = withHref(homeRow('a', range('x', 8)))
    const chain = place('chain', { branchCount: 4 })
    const branchOfVisible = place('z', { branches: [{ id: 'y0', lat: 0, lng: 0 }] })
    const second = withHref({ ...homeRow('b', range('y', 8)), places: [...homeRow('b', range('y', 8)).places, place('x0'), chain, branchOfVisible, place('y8'), place('y9')] })
    expect(more(assembleHome([first, second]), 'b')).toEqual(['y8', 'y9'])
  })

  it('los extras no cuentan como mostrados: la fila siguiente los puede mostrar como cards', () => {
    const rows = assembleHome([withHref(homeRow('a', range('x', 11))), withHref(homeRow('b', ['x8', 'x9', 'x10', 'y0']))])
    expect(more(rows, 'a')).toEqual(['x8', 'x9', 'x10'])
    expect(ids(rows)[1]).toEqual(['b', ['x8', 'x9', 'x10', 'y0']])
  })
})

describe('búsquedas de la home', () => {
  const open = everyDay('08:00', '23:59')
  const places = [
    ...Array.from({ length: 6 }, (_, index) => row({ id: `r${index}`, categories: ['restaurant'], tags: ['lunch', 'japanese'], diet: { vegan: 'unknown', vegetarian: 'fully', glutenFree: 'has_options' }, hours: open })),
    ...Array.from({ length: 6 }, (_, index) => row({ id: `b${index}`, categories: ['bar'], tags: ['drinks'], hours: open })),
    ...Array.from({ length: 6 }, (_, index) => row({ id: `c${index}`, categories: ['cafe'], iconCategory: 'coffee', tags: ['shared_afternoon_tea'], hours: open })),
    ...Array.from({ length: 6 }, (_, index) => row({ id: `g${index}`, categories: ['grill'], iconCategory: 'grill', hours: open })),
  ]
  const all = HOME_SECTIONS

  it('nunca llaman al modelo ni al embedding, y cada fila trae lo de su búsqueda con su "Ver todos"', async () => {
    const { store } = fakeStore(places)
    const { cache, interpreted, embedded } = fakeCache()
    const rows = await homeSectionRows({ store, cache }, all, now)
    expect(interpreted).toEqual([])
    expect(embedded).toEqual([])
    const of = (id: string) => rows.find((entry) => entry.id === id)!
    expect(of('lunch').places.map((item) => item.id).sort()).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5'])
    expect(of('drinks').places.every((item) => item.id.startsWith('b'))).toBe(true)
    expect(of('shared_snack').places.map((item) => item.id).sort()).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5'])
    expect(of('classics').places.map((item) => item.id).sort()).toEqual(['g0', 'g1', 'g2', 'g3', 'g4', 'g5'])
    expect(of('vegetarian').places.every((item) => item.id.startsWith('r'))).toBe(true)
    expect(of('open_now').places).toHaveLength(24)
    expect(of('lunch').href).toBe('/search?intent=eat&sub=lunch&f=open%3Anow&loc=all')
    expect(of('shared_snack').href).toBe('/search?q=Merienda+para+2&f=open%3Anow&loc=all')
    expect(of('world').href).toBe('/search?f=open%3Anow%2Csection%3Aworld&loc=all')
  })

  it('buscan con "Abierto ahora" (abiertos en ese momento)', async () => {
    const { store, calls } = fakeStore(places)
    await homeSectionRows({ store, cache: fakeCache().cache }, all, now)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.filters.openAt?.kind === 'now' && call.filters.openAt.moment.day === 1 && call.filters.openAt.moment.time === '13:00')).toBe(true)
  })

  it('sólo abiertos ahora: ni cerrados, ni los que abren más tarde, ni los sin horario', async () => {
    // Lunes 13:00: open abierto ahora, later abre a las 20:00, closed cerró a las 12:00.
    const bar = (id: string, hours: CandidateRow['hours']) => row({ id, categories: ['bar'], tags: ['drinks'], hours })
    const { store } = fakeStore([
      bar('closed', { slots: [{ day: 1, opens: '08:00', closes: '12:00' }], status: 'exact' }),
      bar('open', everyDay('12:00', '23:00')),
      bar('later', { slots: [{ day: 1, opens: '20:00', closes: '23:59' }], status: 'exact' }),
      bar('unknown', { slots: [], status: 'none' }),
      bar('vague', { ...everyDay('00:00', null), status: 'vague' }),
    ])
    const rows = await homeSectionRows({ store, cache: fakeCache().cache }, all, now)
    expect(rows.find((entry) => entry.id === 'drinks')!.places.map((item) => item.id)).toEqual(['open'])
    expect(rows.find((entry) => entry.id === 'open_now')!.places.map((item) => item.id)).toEqual(['open'])
  })

  it('si nada está abierto, la búsqueda suelta el horario: la fila queda vacía (y no sale) en vez de mostrar cerrados', async () => {
    const closed = Array.from({ length: 6 }, (_, index) => row({ id: `b${index}`, categories: ['bar'], tags: ['drinks'], hours: { slots: [{ day: 1, opens: '08:00', closes: '12:00' }], status: 'exact' } }))
    const rows = await homeSectionRows({ store: fakeStore(closed).store, cache: fakeCache().cache }, all, now)
    expect(rows.find((entry) => entry.id === 'drinks')!.places).toEqual([])
  })

  it('el pool es de hasta HOME_CONFIG.candidates lugares', async () => {
    const many = Array.from({ length: 45 }, (_, index) => row({ id: `b${index}`, categories: ['bar'], tags: ['drinks'], neighborhoodId: `N${index}`, hours: open }))
    const rows = await homeSectionRows({ store: fakeStore(many).store, cache: fakeCache().cache }, all, now)
    expect(rows.find((entry) => entry.id === 'drinks')!.places).toHaveLength(HOME_CONFIG.candidates)
  })

  it('"Para vos": sin guardados no busca', async () => {
    const { store, calls } = fakeStore(places)
    expect(await homeForYouRow({ store, cache: fakeCache().cache }, [], now)).toBeNull()
    expect(calls).toEqual([])
  })

  it('"Para vos" busca abiertos ahora, como las demás filas', async () => {
    const { store, calls } = fakeStore(places)
    await homeForYouRow({ store, cache: fakeCache().cache }, ['r0', 'r1'], now)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((call) => call.filters.openAt?.kind === 'now' && call.filters.openAt.moment.time === '13:00')).toBe(true)
  })

  it('"Para vos" usa los guardados como señal de gustos y devuelve la afinidad de los candidatos de ese tipo', async () => {
    // 14 bares y 6 cafés, en barrios distintos (la variedad no recorta): guardar 2 bares arma el perfil de bares.
    const bars = Array.from({ length: 14 }, (_, index) => row({ id: `bar${index}`, categories: ['bar'], iconCategory: 'beer', tags: ['drinks'], neighborhoodId: `N${index}`, hours: open }))
    const cafes = Array.from({ length: 6 }, (_, index) => row({ id: `cafe${index}`, categories: ['cafe'], iconCategory: 'coffee', neighborhoodId: `M${index}`, hours: open }))
    const vectors = Object.fromEntries([...bars.map((bar) => [bar.id, [1, 0, 0]]), ...cafes.map((cafe) => [cafe.id, [0, 1, 0]])])
    const { store } = fakeStore([...bars, ...cafes], [], vectors)
    const saved = ['bar0', 'bar1']
    const result = await homeForYouRow({ store, cache: fakeCache().cache }, saved, now)
    const forYou = result!.row
    expect(forYou?.id).toBe('for_you')
    expect(forYou!.places.length).toBeGreaterThanOrEqual(4)
    expect(forYou!.places.every((item) => item.id.startsWith('bar') && !saved.includes(item.id))).toBe(true)
    // La afinidad: los bares (tipo con perfil) sí, los cafés (sin perfil) no.
    expect(Object.keys(result!.affinity ?? {}).some((id) => id.startsWith('bar'))).toBe(true)
    expect(Object.keys(result!.affinity ?? {}).some((id) => id.startsWith('cafe'))).toBe(false)
    // Con un solo guardado del tipo no hay perfil: ni fila ni afinidad.
    const single = await homeForYouRow({ store, cache: fakeCache().cache }, ['bar0'], now)
    expect(single?.row ?? null).toBeNull()
    expect(Object.keys(single?.affinity ?? {})).toEqual([])
  })

  it('"Ver todos" = fila: cada lugar de la fila sale en /search con los parámetros de su href (con y sin ubicación)', async () => {
    // Bares y restaurantes en dos barrios lejos entre sí: la ubicación de la persona no tiene que achicar el "Ver todos".
    const spread = [
      ...Array.from({ length: 12 }, (_, index) => row({ id: `bar${index}`, categories: ['bar'], tags: ['drinks', 'groups'], neighborhoodId: `N${index}`, hours: open, lat: -34.9 - index * 0.01 })),
      ...Array.from({ length: 12 }, (_, index) => row({ id: `res${index}`, categories: ['restaurant'], tags: ['lunch', 'dinner', 'date'], neighborhoodId: `M${index}`, hours: open, lat: -34.85 - index * 0.01 })),
      // Cafés con desayuno, brunch, almuerzo o menú del día: entran en Comer › sub (tagWins) igual que en la fila.
      ...Array.from({ length: 6 }, (_, index) => row({ id: `cafe${index}`, categories: ['cafe'], tags: ['breakfast', 'brunch', 'lunch', 'menu_of_the_day'], neighborhoodId: `C${index}`, hours: open, lat: -34.88 - index * 0.01 })),
      row({ id: 'sin-horario', categories: ['bar'], tags: ['drinks'] }),
    ]
    const { cache, interpreted, embedded } = fakeCache()
    const deps = { store: fakeStore(spread).store, cache }
    const rows = await homeSectionRows(deps, all, now)
    for (const id of ['breakfast', 'brunch', 'lunch', 'menu_of_the_day']) {
      expect(rows.find((entry) => entry.id === id)!.places.some((place) => place.id.startsWith('cafe')), id).toBe(true)
    }
    for (const entry of rows.filter((item) => item.places.length > 0)) {
      const params = new URL(entry.href!, 'http://x').searchParams
      for (const userLocation of [null, '-34.901,-56.164']) {
        const response = await runSearch(params.get('q') ?? '', deps, {
          intent: params.get('intent'),
          sub: params.get('sub'),
          filters: params.get('f'),
          loc: params.get('loc'),
          userLocation,
          // /search con algo que buscar usa la ubicación por defecto: el "Ver todos" la pisa con loc=all.
          defaultNear: true,
          now,
        })
        const found = new Set(response.results.map((result) => result.id))
        expect(entry.places.filter((place) => !found.has(place.id)), `${entry.id} ${userLocation}`).toEqual([])
        // Con el nombre de la fila en el buscador: ningún chip lo repite (ni el tag ni el momento).
        if (params.get('q')) expect(response.bar.extras.filter(showsInBar), entry.id).toEqual([])
        expect(response.interpreted.chips.find((chip) => chip.kind === 'openAt')?.label).toBe('Abierto ahora')
      }
    }
    // Ni las filas ni sus "Ver todos" (también los de texto) pagan modelo o embedding.
    expect(interpreted).toEqual([])
    expect(embedded).toEqual([])
    expect(rows.filter((entry) => new URL(entry.href!, 'http://x').searchParams.get('q')).map((entry) => entry.id).sort()).toEqual(
      ['after_office', 'couple', 'friends', 'menu_of_the_day', 'quick', 'shared_snack'].filter((id) => rows.some((entry) => entry.id === id)),
    )
  })
})
