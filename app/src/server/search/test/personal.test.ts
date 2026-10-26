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
  place: row({ id: `c${index}`, categories: ['restaurant', 'cafe'], iconCategory: 'coffee', tags: ['terrace'], style: 'casual', prominence: 0.5, ...overrides }),
  vector: COFFEE,
})
const grill = (index: number, overrides: Partial<CandidateRow> = {}): Place => ({
  place: row({ id: `g${index}`, categories: ['grill', 'restaurant'], iconCategory: 'grill', tags: ['picada', 'groups'], style: 'casual', prominence: 0.5, ...overrides }),
  vector: GRILL,
})
const other = (index: number, overrides: Partial<CandidateRow> = {}): Place => ({
  place: row({ id: `o${index}`, categories: ['restaurant'], tags: ['japanese'], style: 'cuidado', prominence: 0.5, ...overrides }),
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

const sectionIds = (response: Awaited<ReturnType<ReturnType<typeof setup>['search']>>) => response.sections?.map((section) => section.id) ?? []
const personalIds = (response: Awaited<ReturnType<ReturnType<typeof setup>['search']>>) =>
  [...(response.sections ?? []).filter((section) => section.id === 'profile' || section.id === 'similar'), ...(response.forYou ? [response.forYou] : [])].flatMap(
    (section) => section.placeIds,
  )

describe('con grupos', () => {
  it('con menos de 3 likes no hay "Basado en lo que te gusta"', async () => {
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['c0', 'c1'] })
    expect(response.sections).not.toBeNull()
    expect(sectionIds(response)).not.toContain('profile')
    expect(response.debug?.personal.groups.find((group) => group.id === 'profile')).toMatchObject({ shown: false, reason: '2 likes (mínimo 3)' })
  })

  it('con 1 like puede haber "Parecido a", primero y sin "Ver todos"', async () => {
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['g0'] })
    expect(response.sections?.[0]).toMatchObject({ id: 'similar', title: 'Parecido a g0', total: null })
    expect([...response.sections![0].placeIds].sort()).toEqual(['g1', 'g2', 'g3', 'g4'])
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

  it('"Parecido a" va primero y "Basado en lo que te gusta" toma lo que queda; sin los lugares que te gustaron y sin repetir', async () => {
    // 12 cafés: 3 likes, "Parecido a" se lleva 6 y "Basado" los 3 que quedan.
    const places = [...Array.from({ length: 12 }, (_, index) => coffee(index)), ...basePlaces().slice(7)]
    const { search } = setup(places)
    const response = await search('comer con amigos', { likes: ['c0', 'c1', 'c2'] })
    expect(sectionIds(response).slice(0, 2)).toEqual(['similar', 'profile'])
    expect(response.sections?.[0].placeIds).toHaveLength(6)
    expect(response.sections?.[1]).toMatchObject({ id: 'profile', title: 'Basado en lo que te gusta', total: null })
    expect(response.sections?.[1].placeIds).toHaveLength(3)
    expect([...response.sections![0].placeIds, ...response.sections![1].placeIds].sort()).toEqual(['c10', 'c11', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'])
    // Los que te gustaron siguen en la búsqueda, pero no en los grupos personales.
    expect(response.results.map((result) => result.id)).toEqual(expect.arrayContaining(['c0', 'c1', 'c2']))
    expect(personalIds(response).some((id) => ['c0', 'c1', 'c2'].includes(id))).toBe(false)
    const all = response.sections!.flatMap((section) => section.placeIds)
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(response.results.map((result) => result.id).sort())
  })

  it('si "Parecido a" se lleva todo lo parecido, "Basado" no llega a 3 y no sale', async () => {
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['c0', 'c1', 'c2'] })
    expect([...response.sections![0].placeIds].sort()).toEqual(['c3', 'c4', 'c5', 'c6'])
    expect(sectionIds(response)).not.toContain('profile')
    expect(response.debug?.personal.groups.map((group) => [group.id, group.shown])).toEqual([['similar', true], ['profile', false]])
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
    const tags = (index: number) => (index % 3 === 0 ? ['picada', 'groups'] : index % 3 === 1 ? ['japanese'] : ['terrace'])
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
    expect([...response.sections![0].placeIds].sort()).toEqual(['n1', 'n2', 'n3'])

    // Con vecinos más lejanos, el top 10 % queda debajo de 0,65 y manda el piso: 0,78 entra, 0,6 no.
    const spread = [
      place('L', [1, 0, 0], 0),
      ...['m1', 'm2', 'm3'].map((id, index) => place(id, [1, 0.8, 0], index)),
      ...['w1', 'w2', 'w3'].map((id, index) => place(id, [1, 1.33, 0], index)),
      ...Array.from({ length: 30 }, (_, index) => place(`f${index}`, [0, 0, 1], index)),
    ]
    const wide = await setup(spread).search('comer con amigos', { likes: ['L'] })
    expect(wide.debug?.personal.similarTo?.threshold).toBe(0.65)
    expect([...wide.sections![0].placeIds].sort()).toEqual(['m1', 'm2', 'm3'])
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
    row: row(overrides), pinned: false, matchLevel: 'has', open: null, rrf: score, boosts: {}, baseScore: score, multiplier: 1, score, positionWithoutQuality: 1,
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
    expect(result.sections?.map((section) => section.id)).toEqual(['profile', 'live_music', 'share', 'outdoor', 'world', 'more'])
    expect(result.displaced).toEqual(['classics'])
    expect(result.sections?.[0]).toEqual({ id: 'profile', title: 'Basado en lo que te gusta', placeIds: ['p0', 'p1', 'p2'], total: null })
    const all = result.sections!.flatMap((section) => section.placeIds)
    expect(new Set(all).size).toBe(all.length)
    expect(all).toHaveLength(20)
  })
})
