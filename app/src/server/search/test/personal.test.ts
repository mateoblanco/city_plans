import { describe, expect, it } from 'vitest'
import type { CandidateRow } from '../candidates'
import type { Fused } from '../fuse'
import { runSearch, type SearchOptions } from '../search'
import { buildSections } from '../sections'
import { fakeCache, fakeStore, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')

// Embeddings de juguete: los cafés apuntan a x, las parrillas a y, el resto a z.
const COFFEE = [1, 0.1, 0]
const GRILL = [0.1, 1, 0]
const OTHER = [0, 0.1, 1]

type Place = { place: CandidateRow; vector: number[] }

const coffee = (index: number, overrides: Partial<CandidateRow> = {}): Place => ({
  place: row({ id: `c${index}`, categories: ['restaurant', 'cafe'], iconCategory: 'coffee', tags: ['terrace', 'groups'], style: 'casual', prominence: 0.5, ...overrides }),
  vector: COFFEE,
})
const grill = (index: number, overrides: Partial<CandidateRow> = {}): Place => ({
  place: row({ id: `g${index}`, categories: ['grill', 'restaurant'], iconCategory: 'grill', tags: ['picada', 'groups'], style: 'casual', prominence: 0.5, ...overrides }),
  vector: GRILL,
})
const other = (index: number, overrides: Partial<CandidateRow> = {}): Place => ({
  place: row({ id: `o${index}`, categories: ['restaurant'], tags: ['japanese', 'groups'], style: 'cuidado', prominence: 0.5, ...overrides }),
  vector: OTHER,
})

/** 7 cafés, 5 parrillas y 6 otros: alcanza para agrupar "comer con amigos". */
const basePlaces = (): Place[] => [
  ...Array.from({ length: 7 }, (_, index) => coffee(index)),
  ...Array.from({ length: 5 }, (_, index) => grill(index)),
  ...Array.from({ length: 6 }, (_, index) => other(index)),
]

function setup(places: Place[] = basePlaces(), names: Parameters<typeof fakeStore>[1] = []) {
  const { store } = fakeStore(places.map(({ place }) => place), names, Object.fromEntries(places.map(({ place, vector }) => [place.id, vector])))
  const search = (query: string, options: SearchOptions = {}) => runSearch(query, { store, cache: fakeCache().cache }, { now, debug: true, ...options })
  return { search }
}

type Response = Awaited<ReturnType<ReturnType<typeof setup>['search']>>
const sectionIds = (response: Response) => response.sections?.map((section) => section.id) ?? []
const section = (response: Response, id: string) => response.sections?.find((entry) => entry.id === id)
const personalIds = (response: Response) =>
  [...(response.sections ?? []).filter((section) => section.id === 'profile' || section.id === 'similar'), ...(response.forYou ? [response.forYou] : [])].flatMap(
    (section) => section.placeIds,
  )

describe('con grupos', () => {
  it('con menos de 3 likes no hay "Basado en lo que te gusta"', async () => {
    // Ningún like en la búsqueda: no hay "Parecido a" y se prueba "Basado", que pide 3 likes.
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['zz0', 'zz1'] })
    expect(response.sections).not.toBeNull()
    expect(sectionIds(response)).not.toContain('profile')
    expect(response.debug?.personal.groups.find((group) => group.id === 'profile')).toMatchObject({ shown: false, reason: '0 likes (mínimo 3)' })
  })

  it('con 1 like puede haber "Parecido a", después del primer grupo del catálogo y sin "Ver todos"', async () => {
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['g0'] })
    expect(sectionIds(response).indexOf('similar')).toBe(1)
    expect(section(response, 'similar')).toMatchObject({ title: 'Parecido a g0', total: null })
    expect([...section(response, 'similar')!.placeIds].sort()).toEqual(['g1', 'g2', 'g3', 'g4'])
    expect(response.debug?.personal.similarTo).toMatchObject({ id: 'g0' })
    // El parecido de cada lugar del grupo, en debug.
    expect(response.debug?.personal.groups.find((group) => group.id === 'similar')?.places.every((place) => place.similarity > 0.68)).toBe(true)
  })

  it('"Parecido a" elige el like que más encaja en la búsqueda: con Comer, la parrilla y no el café', async () => {
    // El café es el más conocido: sin intención va primero; con Comer, la parrilla suma eatFit y lo pasa.
    const places = basePlaces()
    places[0] = coffee(0, { prominence: 1 })
    const { search } = setup(places)
    const anything = await search('algo lindo', { likes: ['c0', 'g0'] })
    expect(anything.debug?.personal.similarTo?.id).toBe('c0')
    const eat = await search('algo lindo', { likes: ['c0', 'g0'], intent: 'eat' })
    expect(eat.debug?.personal.similarTo?.id).toBe('g0')
    expect(eat.sections?.find((section) => section.id === 'similar')?.title).toBe('Parecido a g0')
  })

  it('un solo grupo personal: "Parecido a" si sale; sin los lugares que te gustaron y sin repetir', async () => {
    // 12 cafés y 3 likes: "Parecido a" se lleva 6 y "Basado en lo que te gusta" no sale aunque alcanzaría.
    const places = [...Array.from({ length: 12 }, (_, index) => coffee(index)), ...basePlaces().slice(7)]
    const { search } = setup(places)
    const response = await search('comer con amigos', { likes: ['c0', 'c1', 'c2'] })
    expect(sectionIds(response).indexOf('similar')).toBe(1)
    expect(sectionIds(response)).not.toContain('profile')
    expect(section(response, 'similar')?.placeIds).toHaveLength(6)
    expect(response.debug?.personal.groups.find((group) => group.id === 'profile')).toMatchObject({ shown: false, reason: 'ya hay "Parecido a"' })
    // Los que te gustaron siguen en la búsqueda, pero no en los grupos personales.
    expect(response.results.map((result) => result.id)).toEqual(expect.arrayContaining(['c0', 'c1', 'c2']))
    expect(personalIds(response).some((id) => ['c0', 'c1', 'c2'].includes(id))).toBe(false)
    const all = response.sections!.flatMap((section) => section.placeIds)
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(response.results.map((result) => result.id).sort())
  })

  it('sin "Parecido a" (ningún like salió en la búsqueda), sale "Basado en lo que te gusta" en su lugar', async () => {
    // 3 cafés que te gustaron en Pocitos; la búsqueda es en Cordón.
    const liked = ['l0', 'l1', 'l2'].map((id) => ({ place: row({ id, neighborhoodId: 'POCITOS', categories: ['restaurant', 'cafe'], tags: ['groups'] }), vector: COFFEE }))
    const { search } = setup([...basePlaces(), ...liked])
    const response = await search('comer con amigos en cordon', { likes: ['l0', 'l1', 'l2'] })
    expect(response.debug?.personal.similarTo).toBeNull()
    expect(sectionIds(response).indexOf('profile')).toBe(1)
    expect(sectionIds(response)).not.toContain('similar')
  })

  it('con "Parecido a", "Basado en lo que te gusta" no sale', async () => {
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['c0', 'c1', 'c2'] })
    expect([...section(response, 'similar')!.placeIds].sort()).toEqual(['c3', 'c4', 'c5', 'c6'])
    expect(sectionIds(response)).not.toContain('profile')
    expect(response.debug?.personal.groups.map((group) => [group.id, group.shown])).toEqual([['similar', true], ['profile', false]])
  })

  it('con precio pedido, los de precio desconocido son "maybe" y no entran en los personales', async () => {
    const places = basePlaces().map(({ place, vector }) => ({ place: { ...place, price: place.id === 'c4' || place.id === 'c5' ? 'unknown' : 'low' }, vector }))
    const { search } = setup(places)
    const response = await search('comer con amigos barato', { likes: ['c0', 'c1', 'c2'] })
    const levels = new Map(response.results.map((result) => [result.id, result.matchLevel]))
    expect(levels.get('c4')).toBe('maybe')
    expect(levels.get('c3')).toBe('has')
    expect(personalIds(response)).not.toContain('c4')
    expect(personalIds(response)).not.toContain('c5')
  })

  it('un like que es una sucursal escondida también saca a su card de los bloques personales', async () => {
    const places = basePlaces()
    places[5] = coffee(5, { brandKey: 'marca', brandCount: 2, prominence: 0.9 })
    places[6] = coffee(6, { brandKey: 'marca', brandCount: 2, prominence: 0.1 })
    const { search } = setup(places)
    const response = await search('comer con amigos', { likes: ['c0', 'c1', 'c6'] })
    expect(response.results.map((result) => result.id)).toContain('c5')
    expect(personalIds(response)).not.toContain('c5')
  })

  it('"Parecido a" toma el top 10 % más parecido de toda la base, con piso 0,65', async () => {
    // Cerca de L: 3 muy parecidos (0,98), 4 medianos (0,78, sobre el piso) y 12 lejos (0). El top 10 % empieza en 0,98.
    // Todos con groups: con "con amigos", los que no lo tienen son "maybe" y no entran en los personales.
    const tags = (index: number) => (index % 3 === 0 ? ['picada', 'groups'] : index % 3 === 1 ? ['japanese', 'groups'] : ['terrace', 'groups'])
    const place = (id: string, vector: number[], index: number): Place => ({ place: row({ id, tags: tags(index), prominence: 0.5 }), vector })
    const places = [
      place('L', [1, 0, 0], 0),
      ...['n1', 'n2', 'n3'].map((id, index) => place(id, [1, 0.2, 0], index)),
      ...['m1', 'm2', 'm3', 'm4'].map((id, index) => place(id, [1, 0.8, 0], index)),
      ...Array.from({ length: 12 }, (_, index) => place(`f${index}`, [0, 0, 1], index)),
    ]
    const { search } = setup(places)
    const response = await search('comer con amigos', { likes: ['L'] })
    expect(response.debug?.personal.similarTo).toMatchObject({ id: 'L', topCut: expect.closeTo(0.98, 2), threshold: expect.closeTo(0.98, 2) })
    expect([...section(response, 'similar')!.placeIds].sort()).toEqual(['n1', 'n2', 'n3'])

    // Con vecinos más lejanos, el top 10 % queda debajo de 0,65 y manda el piso: 0,78 entra, 0,6 no.
    const spread = [
      place('L', [1, 0, 0], 0),
      ...['m1', 'm2', 'm3'].map((id, index) => place(id, [1, 0.8, 0], index)),
      ...['w1', 'w2', 'w3'].map((id, index) => place(id, [1, 1.33, 0], index)),
      ...Array.from({ length: 30 }, (_, index) => place(`f${index}`, [0, 0, 1], index)),
    ]
    const wide = await setup(spread).search('comer con amigos', { likes: ['L'] })
    expect(wide.debug?.personal.similarTo?.threshold).toBe(0.65)
    expect([...section(wide, 'similar')!.placeIds].sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('sin al menos 3 por encima del umbral, no hay grupo', async () => {
    const places = [...basePlaces(), { place: row({ id: 'x', categories: ['restaurant'] }), vector: [1, 1, 1] }]
    const { search } = setup(places)
    const response = await search('comer con amigos', { likes: ['x'] })
    expect(sectionIds(response)).not.toContain('similar')
    expect(response.debug?.personal.groups.find((group) => group.id === 'similar')).toMatchObject({ shown: false })
  })
})

describe('sin grupos: "Para vos"', () => {
  // Un plato vuelve específica la búsqueda: todos tienen pizza.
  const withPizza = () => basePlaces().map(({ place, vector }) => ({ place: { ...place, tags: [...place.tags, 'pizza'] }, vector }))

  it('de 3 a 4 lugares de la misma búsqueda, sin los que te gustaron; results no cambia', async () => {
    const { search } = setup(withPizza())
    const without = await search('pizza')
    const response = await search('pizza', { likes: ['c0', 'c1', 'c2'] })
    expect(response.sections).toBeNull()
    expect(response.forYou).toMatchObject({ id: 'for_you', title: 'Para vos', total: null })
    expect(response.forYou!.placeIds).toHaveLength(4)
    expect(response.forYou!.placeIds.every((id) => ['c3', 'c4', 'c5', 'c6'].includes(id))).toBe(true)
    expect(response.results.map((result) => result.id)).toEqual(without.results.map((result) => result.id))
  })

  it('con menos de 3 likes no hay "Para vos"', async () => {
    const { search } = setup(withPizza())
    const response = await search('pizza', { likes: ['c0', 'c1'] })
    expect(response.forYou).toBeNull()
  })

  it('sólo elige resultados "has": los que quizás tienen el plato ("maybe") no entran', async () => {
    // Los cafés parecidos al perfil sólo tienen el tag milanesa (maybe); los demás tienen el plato (has).
    const places = basePlaces().map(({ place, vector }) => ({
      place: place.id.startsWith('c') && Number(place.id.slice(1)) >= 3 ? { ...place, tags: [...place.tags, 'milanesa'] } : { ...place, dishes: ['milanesa napolitana'] },
      vector,
    }))
    const { search } = setup(places)
    const response = await search('milanesa napolitana', { likes: ['c0', 'c1', 'c2'] })
    expect(response.results.filter((result) => result.matchLevel === 'maybe').map((result) => result.id).sort()).toEqual(['c3', 'c4', 'c5', 'c6'])
    expect(response.forYou).toBeNull()
    expect(response.debug?.personal.groups.find((group) => group.id === 'for_you')?.reason).toMatch(/^0 resultados "has"/)
  })

  it('con menos de 12 resultados "has" no hay bloques personales; desde 12, sí', async () => {
    const few = await setup(withPizza().slice(0, 11)).search('pizza', { likes: ['c0', 'c1', 'c2'] })
    expect(few.forYou).toBeNull()
    expect(few.debug?.personal.skipped).toBe('11 resultados "has" (mínimo 12)')
    const enough = await setup(withPizza().slice(0, 12)).search('pizza', { likes: ['c0', 'c1', 'c2'] })
    expect(enough.forYou?.placeIds.length).toBeGreaterThanOrEqual(3)
  })

  it('no aparece en búsquedas por nombre', async () => {
    const { search } = setup(withPizza(), [{ id: 'c3', name: 'c3', similarity: 0.9, wordSimilarity: 0.9 }])
    const response = await search('cafe tres', { likes: ['c0', 'c1', 'c2'] })
    expect(response.forYou).toBeNull()
    expect(response.debug?.personal.skipped).toBe('búsqueda por nombre')
  })
})

describe('el perfil no cambia la búsqueda', () => {
  it('mismos resultados, en el mismo orden, con y sin likes (los que te gustaron no suben)', async () => {
    const { search } = setup()
    const without = await search('comer con amigos', { debug: false })
    const withLikes = await search('comer con amigos', { debug: false, likes: ['c0', 'c1', 'c2', 'g0'] })
    expect(withLikes.results).toEqual(without.results)
  })

  it('profile=off da lo mismo que sin likes', async () => {
    for (const query of ['comer con amigos', 'pizza']) {
      const { search } = setup()
      const without = await search(query, { debug: false })
      const off = await search(query, { debug: false, likes: ['c0', 'c1', 'c2', 'g0'], profile: false })
      expect(off).toEqual(without)
    }
    const { search } = setup()
    expect((await search('comer con amigos', { likes: ['c0'], profile: false })).debug?.personal.skipped).toBe('profile=off')
  })
})

describe('tope de grupos', () => {
  const fused = (overrides: Partial<CandidateRow> & { id: string }, score: number): Fused => ({
    row: row(overrides), pinned: false, matchLevel: 'has', dishLevel: 'has', open: null, rrf: score, boosts: {}, baseScore: score, multiplier: 1, score, positionWithoutQuality: 1,
  })

  it('un grupo personal desplaza al del catálogo de menor puntaje promedio, y ningún lugar se repite', () => {
    const tags: Record<number, string[]> = {}
    for (const index of [3, 4, 5]) tags[index] = ['live_music']
    for (const index of [6, 7, 8]) tags[index] = ['picada']
    for (const index of [9, 10, 11]) tags[index] = ['terrace']
    for (const index of [12, 13, 14]) tags[index] = ['japanese']
    const categories: Record<number, string[]> = { 15: ['grill'], 16: ['bodegon'], 17: ['chiviteria'] }
    const items = Array.from({ length: 20 }, (_, index) =>
      fused({ id: `p${index}`, tags: tags[index] ?? [], categories: categories[index] ?? ['restaurant'], prominence: 0.8 }, 1 - index / 100))
    const requested = ['live_music', 'share', 'outdoor', 'world', 'classics'] as const
    expect(buildSections(items, [...requested], 'es').chosen).toHaveLength(5)

    const personal = [{ id: 'profile' as const, title: 'Basado en lo que te gusta', items: [items[0], items[1], items[2]] }]
    const result = buildSections(items, [...requested], 'es', personal)
    // El primer grupo del catálogo va antes que el personal.
    expect(result.sections?.map((section) => section.id)).toEqual(['live_music', 'profile', 'share', 'outdoor', 'world', 'more'])
    expect(result.displaced).toEqual(['classics'])
    expect(result.sections?.[1]).toEqual({ id: 'profile', title: 'Basado en lo que te gusta', placeIds: ['p0', 'p1', 'p2'], total: null })
    const all = result.sections!.flatMap((section) => section.placeIds)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(20)
  })

  describe('grupo 100 % de la dieta', () => {
    const glutenFree = { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'fully' }
    const vegan = { vegan: 'fully', vegetarian: 'has_options', glutenFree: 'unknown' }
    const tags: Record<number, string[]> = {}
    for (const index of [3, 4, 5]) tags[index] = ['live_music']
    for (const index of [6, 7, 8]) tags[index] = ['picada']
    for (const index of [9, 10, 11]) tags[index] = ['terrace']
    for (const index of [12, 13, 14]) tags[index] = ['japanese']
    const categories: Record<number, string[]> = { 15: ['grill'], 16: ['bodegon'], 17: ['chiviteria'] }
    const build = (fully: number[], level = glutenFree) => Array.from({ length: 24 }, (_, index) =>
      fused({ id: `p${index}`, tags: tags[index] ?? [], categories: categories[index] ?? ['restaurant'], prominence: 0.8, ...(fully.includes(index) ? { diet: level } : {}) }, 1 - index / 100))
    const requested = ['live_music', 'share', 'outdoor', 'world', 'classics'] as const

    it('va primero, antes del catálogo y los personales, no cuenta para el tope y ningún lugar se repite', () => {
      const items = build([1, 19, 20, 21])
      const personal = [{ id: 'profile' as const, title: 'Basado en lo que te gusta', items: [items[0], items[1], items[2]] }]
      const result = buildSections(items, [...requested], 'es', personal, 'glutenFree')
      expect(result.sections?.map((section) => section.id)).toEqual(['diet', 'live_music', 'profile', 'share', 'outdoor', 'world', 'more'])
      // p1 ya está en el personal.
      expect(result.sections?.[0]).toEqual({ id: 'diet', title: '100 % sin TACC', placeIds: ['p19', 'p20', 'p21'], total: null })
      expect(result.diet).toEqual({ key: 'glutenFree', count: 3, shown: true, placedIn: null })
      const all = result.sections!.flatMap((section) => section.placeIds)
      expect(new Set(all).size).toBe(all.length)
      expect(all).toHaveLength(24)
    })

    it('orden completo: dieta, primer grupo del catálogo, "Parecido a", "Basado en…", el resto y "Más opciones"', () => {
      const items = build([19, 20, 21])
      const personal = [
        { id: 'similar' as const, title: 'Parecido a Lugar', items: [items[0], items[1], items[2]] },
        { id: 'profile' as const, title: 'Basado en lo que te gusta', items: [items[22], items[23], items[18]] },
      ]
      const result = buildSections(items, [...requested], 'es', personal, 'glutenFree')
      expect(result.sections?.map((section) => section.id)).toEqual(['diet', 'live_music', 'similar', 'profile', 'share', 'outdoor', 'more'])
    })

    it('sin personales: primero el grupo de dieta y los cinco del catálogo', () => {
      const result = buildSections(build([19, 20, 21]), [...requested], 'es', [], 'glutenFree')
      expect(result.sections?.map((section) => section.id)).toEqual(['diet', 'live_music', 'share', 'outdoor', 'world', 'classics', 'more'])
    })

    it('con 2 ya sale', () => {
      const result = buildSections(build([19, 20]), [...requested], 'es', [], 'glutenFree')
      expect(result.sections?.[0]).toEqual({ id: 'diet', title: '100 % sin TACC', placeIds: ['p19', 'p20'], total: null })
    })

    it('con uno solo, va primero en el primer grupo del catálogo y nunca en "Más opciones"', () => {
      // p19 no entra en ningún grupo del catálogo: sin la dieta iría a "Más opciones".
      expect(buildSections(build([]), [...requested], 'es').sections?.find((section) => section.id === 'more')?.placeIds).toContain('p19')
      const result = buildSections(build([19]), [...requested], 'es', [], 'glutenFree')
      expect(result.sections?.some((section) => section.id === 'diet')).toBe(false)
      const first = result.sections![0]
      expect(first.placeIds[0]).toBe('p19')
      expect(first.placeIds.length).toBeLessThanOrEqual(6)
      expect(result.diet).toEqual({ key: 'glutenFree', count: 1, shown: false, placedIn: first.id })
      const all = result.sections!.flatMap((section) => section.placeIds)
      expect(new Set(all).size).toBe(all.length)
      expect(all).toHaveLength(24)
    })

    it('con uno solo y un personal, va en el primer grupo del catálogo', () => {
      const items = build([19])
      const personal = [{ id: 'profile' as const, title: 'Basado en lo que te gusta', items: [items[0], items[1], items[2]] }]
      const result = buildSections(items, [...requested], 'es', personal, 'glutenFree')
      expect(result.sections?.map((section) => section.id).slice(0, 2)).toEqual(['live_music', 'profile'])
      expect(result.sections?.[0].placeIds[0]).toBe('p19')
    })

    it('vegano fully entra en el grupo vegetariano', () => {
      const result = buildSections(build([19, 20, 21], vegan), [...requested], 'es', [], 'vegetarian')
      expect(result.sections?.[0]).toMatchObject({ id: 'diet', title: '100 % vegetariano', placeIds: ['p19', 'p20', 'p21'] })
    })

    it('sin dieta (o con más de una) no hay grupo', () => {
      const result = buildSections(build([19, 20, 21]), [...requested], 'es')
      expect(result.sections?.some((section) => section.id === 'diet')).toBe(false)
      expect(result.diet).toBeNull()
    })
  })
})
