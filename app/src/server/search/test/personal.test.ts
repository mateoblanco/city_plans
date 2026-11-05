import { describe, expect, it } from 'vitest'
import { ICON_CATEGORY_KEYS, ICON_FAMILIES } from '@shared/icon-categories.ts'
import type { Collapsed } from '../branches'
import type { CandidateRow, LikedPlace } from '../candidates'
import type { Fused } from '../fuse'
import type { IntentId } from '@shared/intents.ts'
import { ALL_GROUPS } from '@shared/tags.ts'
import { profileReasonTitle, traitPhrase } from '../labels'
import { concreteMismatch, mostLikedKind, personalize, placeKind, profileTraits } from '../personal'
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

/** Un like con sus datos (por defecto, una casa de pastas: tipo comer). */
const likedPlace = (id: string, overrides: Partial<LikedPlace> = {}): LikedPlace => ({
  id, name: id, topCut: null, iconCategory: 'pasta', categories: ['restaurant'], tags: [], style: null, price: 'moderate', neighborhoodId: 'CENTRO', ...overrides,
})

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
  it('sin 2 likes del tipo de la búsqueda no hay "Porque te gustan…"', async () => {
    // Ningún like válido: no hay "Parecido a" y se prueba el perfil de comer, que pide 2 likes de comer.
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['zz0', 'zz1'] })
    expect(response.sections).not.toBeNull()
    expect(sectionIds(response)).not.toContain('profile')
    expect(response.debug?.personal.groups.find((group) => group.id === 'profile')).toMatchObject({ shown: false, reason: 'sin perfil de eat (0 likes, mínimo 2)' })
  })

  it('likes de cafés en una búsqueda de comer: ningún grupo personal', async () => {
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['c0', 'c1', 'c2'], intent: 'eat' })
    expect(sectionIds(response)).not.toContain('profile')
    expect(sectionIds(response)).not.toContain('similar')
    const personal = response.debug!.personal
    expect(personal.active).toEqual({ kind: 'eat', reason: 'intención eat' })
    expect(personal.profiles).toMatchObject([{ kind: 'cafes', likes: ['c0', 'c1', 'c2'], enough: true }])
    expect(personal.groups.map((group) => [group.id, group.reason])).toEqual([
      ['similar', 'ningún like de eat entre los primeros 30'],
      ['profile', 'sin perfil de eat (0 likes, mínimo 2)'],
    ])
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

  it('"Parecido a" elige entre los likes del tipo de la búsqueda: la parrilla y no el café', async () => {
    // El café es el más conocido y sin intención va primero, pero la búsqueda es de comer (11 de 18): la parrilla.
    const places = basePlaces()
    places[0] = coffee(0, { prominence: 1 })
    const { search } = setup(places)
    const anything = await search('algo lindo', { likes: ['c0', 'g0'] })
    expect(anything.debug?.personal.likes.find((like) => like.id === 'c0')?.position).toBe(1)
    expect(anything.debug?.personal.active).toMatchObject({ kind: 'eat', reason: expect.stringMatching(/^dominante eat: 61 %/) })
    expect(anything.debug?.personal.similarTo?.id).toBe('g0')
    const eat = await search('algo lindo', { likes: ['c0', 'g0'], intent: 'eat' })
    expect(eat.debug?.personal.similarTo?.id).toBe('g0')
    expect(eat.sections?.find((section) => section.id === 'similar')?.title).toBe('Parecido a g0')
  })

  it('un solo grupo personal: "Parecido a" si sale; sin los lugares que te gustaron y sin repetir', async () => {
    // 12 parrillas y 3 likes: "Parecido a" se lleva 6 y "Porque te gustan…" no sale aunque alcanzaría.
    const places = [...basePlaces().slice(0, 7), ...Array.from({ length: 12 }, (_, index) => grill(index)), ...basePlaces().slice(12)]
    const { search } = setup(places)
    const response = await search('comer con amigos', { likes: ['g0', 'g1', 'g2'] })
    expect(sectionIds(response).indexOf('similar')).toBe(1)
    expect(sectionIds(response)).not.toContain('profile')
    expect(section(response, 'similar')?.placeIds).toHaveLength(6)
    expect(response.debug?.personal.groups.find((group) => group.id === 'profile')).toMatchObject({ shown: false, reason: 'ya hay "Parecido a"' })
    // Los que te gustaron siguen en la búsqueda, pero no en los grupos personales.
    expect(response.results.map((result) => result.id)).toEqual(expect.arrayContaining(['g0', 'g1', 'g2']))
    expect(personalIds(response).some((id) => ['g0', 'g1', 'g2'].includes(id))).toBe(false)
    const all = response.sections!.flatMap((section) => section.placeIds)
    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(response.results.map((result) => result.id).sort())
  })

  it('sin "Parecido a" (ningún like salió en la búsqueda), sale "Porque te gustan…" en su lugar', async () => {
    // 3 parrillas que te gustaron en Pocitos; la búsqueda es en Cordón.
    const liked = ['l0', 'l1', 'l2'].map((id) => ({ place: row({ id, neighborhoodId: 'POCITOS', categories: ['grill', 'restaurant'], iconCategory: 'grill', tags: ['groups'] }), vector: GRILL }))
    const { search } = setup([...basePlaces(), ...liked])
    const response = await search('comer con amigos en cordon', { likes: ['l0', 'l1', 'l2'] })
    expect(response.debug?.personal.similarTo).toBeNull()
    expect(sectionIds(response).indexOf('profile')).toBe(1)
    expect(sectionIds(response)).not.toContain('similar')
  })

  it('con "Parecido a", "Porque te gustan…" no sale', async () => {
    const { search } = setup()
    const response = await search('comer con amigos', { likes: ['g0', 'g1'] })
    expect([...section(response, 'similar')!.placeIds].sort()).toEqual(['g2', 'g3', 'g4'])
    expect(sectionIds(response)).not.toContain('profile')
    expect(response.debug?.personal.groups.map((group) => [group.id, group.shown])).toEqual([['similar', true], ['profile', false]])
  })

  it('con precio pedido, los de precio desconocido no salen (ni en los personales)', async () => {
    const places = basePlaces().map(({ place, vector }) => ({ place: { ...place, price: place.id === 'c4' || place.id === 'c5' ? 'unknown' : 'low' }, vector }))
    const { search } = setup(places)
    const response = await search('comer con amigos barato', { likes: ['c0', 'c1', 'c2'], intent: 'cafes' })
    const levels = new Map(response.results.map((result) => [result.id, result.matchLevel]))
    expect(levels.has('c4')).toBe(false)
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

  it('"Parecido a" toma el top 20 % más parecido de toda la base, con piso 0,60', async () => {
    // Cerca de L: 3 muy parecidos (0,98), 4 medianos (0,78) y 8 lejos (0). El top 20 % empieza en 0,82.
    // Todos con groups: con "con amigos", los que no lo tienen son "maybe" y no entran en los personales. Todos pasta, para
    // que los datos concretos no saquen a nadie.
    const tags = (index: number) => (index % 3 === 0 ? ['picada', 'groups'] : index % 3 === 1 ? ['japanese', 'groups'] : ['terrace', 'groups'])
    const place = (id: string, vector: number[], index: number): Place => ({ place: row({ id, tags: tags(index), iconCategory: 'pasta', prominence: 0.5 }), vector })
    const places = [
      place('L', [1, 0, 0], 0),
      ...['n1', 'n2', 'n3'].map((id, index) => place(id, [1, 0.2, 0], index)),
      ...['m1', 'm2', 'm3', 'm4'].map((id, index) => place(id, [1, 0.8, 0], index)),
      ...Array.from({ length: 8 }, (_, index) => place(`f${index}`, [0, 0, 1], index)),
    ]
    const { search } = setup(places)
    const response = await search('comer con amigos', { likes: ['L'] })
    expect(response.debug?.personal.similarTo).toMatchObject({ id: 'L', topCut: expect.closeTo(0.82, 2), threshold: expect.closeTo(0.82, 2) })
    expect([...section(response, 'similar')!.placeIds].sort()).toEqual(['n1', 'n2', 'n3'])

    // Con vecinos más lejanos, el top 20 % queda debajo de 0,60 y manda el piso: 0,78 entra, 0,55 no.
    const spread = [
      place('L', [1, 0, 0], 0),
      ...['m1', 'm2', 'm3'].map((id, index) => place(id, [1, 0.8, 0], index)),
      ...['w1', 'w2', 'w3'].map((id, index) => place(id, [1, 1.5, 0], index)),
      ...Array.from({ length: 22 }, (_, index) => place(`f${index}`, [0, 0, 1], index)),
    ]
    const wide = await setup(spread).search('comer con amigos', { likes: ['L'] })
    expect(wide.debug?.personal.similarTo?.threshold).toBe(0.6)
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

describe('"Parecido a": el like arriba y parecido de verdad', () => {
  const item = (id: string, overrides: Partial<CandidateRow> = {}): Collapsed => ({
    row: row({ id, iconCategory: 'pasta', style: 'intermedio', ...overrides }),
    pinned: false, matchLevel: 'has', dishLevel: 'has', open: null, rrf: 1, boosts: {}, baseScore: 1, multiplier: 1, score: 1, positionWithoutQuality: 1, branches: [],
  })
  /** personalize con un solo like y el parecido de cada lugar con él (0 si no se dice). */
  const run = (items: Collapsed[], likeId: string, similarity: Record<string, number>) =>
    personalize(items, {
      liked: [likedPlace(likeId)],
      pairs: { [likeId]: { [likeId]: 1 } },
      df: {},
      total: 1000,
      rows: items.map((entry) => ({ id: entry.row.id, byLike: { [likeId]: similarity[entry.row.id] ?? 0 } })),
    }, [likeId], { grouped: true, lang: 'es' })
  const similarIds = (result: ReturnType<typeof run>) => result.groups.find((group) => group.id === 'similar')?.items.map((entry) => entry.row.id) ?? null

  it('el like tiene que estar entre los primeros 30: en el 31 no hay "Parecido a"', () => {
    const items = (likeAt: number) => {
      const list = Array.from({ length: 40 }, (_, index) => item(`p${index}`))
      list[likeAt] = item('L')
      return list
    }
    const similarity = { p0: 0.9, p1: 0.9, p2: 0.9 }
    const at30 = run(items(29), 'L', similarity)
    expect(at30.debug.similarTo).toMatchObject({ id: 'L', position: 30 })
    expect(similarIds(at30)).toEqual(['p0', 'p1', 'p2'])
    const at31 = run(items(30), 'L', similarity)
    expect(at31.debug.similarTo).toBeNull()
    expect(similarIds(at31)).toBeNull()
    expect(at31.debug.groups.find((group) => group.id === 'similar')?.reason).toBe('ningún like de eat entre los primeros 30')
  })

  it('misma familia de ícono o cocina, mismo style y precio a un nivel como mucho; lo desconocido pasa', () => {
    type Concrete = Parameters<typeof concreteMismatch>[0]
    const liked: Concrete = { iconCategory: 'pasta', tags: ['italian', 'uruguayan'], style: 'intermedio', price: 'moderate' }
    const check = (overrides: Partial<Concrete>) => concreteMismatch(liked, { ...liked, tags: [], ...overrides })
    expect(check({ iconCategory: 'pizza' })).toBeNull()
    expect(check({ iconCategory: 'sushi' })).toBe('otra familia (sushi vs pasta)')
    // Sin ícono, entra por la cocina; la uruguaya no cuenta.
    expect(check({ iconCategory: null, tags: ['italian'] })).toBeNull()
    expect(check({ iconCategory: 'grill', tags: ['uruguayan'] })).toBe('otra familia (grill vs pasta)')
    // Paraguas: asian comparte con japanese.
    expect(concreteMismatch({ ...liked, iconCategory: null, tags: ['asian'] }, { ...liked, iconCategory: null, tags: ['japanese'] })).toBeNull()
    expect(check({ style: 'casual' })).toBe('estilo casual ≠ intermedio')
    expect(check({ style: null })).toBeNull()
    expect(check({ price: 'high' })).toBeNull()
    expect(concreteMismatch({ ...liked, price: 'low' }, { ...liked, tags: [], price: 'high' })).toBe('precio high vs low')
    expect(check({ price: 'unknown' })).toBeNull()
    // Tapas y curry van solas.
    expect(concreteMismatch({ ...liked, iconCategory: 'tapas', tags: [] }, { ...liked, iconCategory: 'seafood', tags: [] })).not.toBeNull()
    expect(concreteMismatch({ ...liked, iconCategory: 'curry', tags: [] }, { ...liked, iconCategory: 'wok', tags: [] })).not.toBeNull()
  })

  it('salen menos de 6 si hay menos parecidos de verdad, y los filtrados quedan en debug', () => {
    const items = [
      item('L'),
      ...['a', 'b', 'c', 'd'].map((id) => item(id, { iconCategory: 'pizza' })),
      item('sushi', { iconCategory: 'sushi' }),
      item('casual', { style: 'casual' }),
      ...Array.from({ length: 6 }, (_, index) => item(`f${index}`)),
    ]
    const result = run(items, 'L', { a: 0.9, b: 0.85, c: 0.8, d: 0.75, sushi: 0.95, casual: 0.92 })
    expect(similarIds(result)).toEqual(['a', 'b', 'c', 'd'])
    expect(result.debug.similarTo?.filtered.map((place) => [place.id, place.reason])).toEqual([
      ['sushi', 'otra familia (sushi vs pasta)'],
      ['casual', 'estilo casual ≠ intermedio'],
    ])
  })

  it('con 2 parecidos de verdad no hay grupo y se prueba "Basado en lo que te gusta"', () => {
    const items = [item('L'), item('a'), item('b'), item('sushi', { iconCategory: 'sushi' }), ...Array.from({ length: 8 }, (_, index) => item(`f${index}`))]
    const result = run(items, 'L', { a: 0.9, b: 0.9, sushi: 0.9 })
    expect(similarIds(result)).toBeNull()
    expect(result.debug.groups.map((group) => [group.id, group.shown])).toEqual([['similar', false], ['profile', false]])
  })

  it('"Porque te gustan…" sólo elige entre los primeros 50 de la búsqueda', () => {
    // 3 likes que no salen (no hay "Parecido a"); los parecidos al perfil están en los puestos `from`…`from + 3`. Cada
    // uno en su barrio: todos son pastas y la variedad sería por barrio.
    const profileAt = (from: number) => {
      const items = Array.from({ length: 60 }, (_, index) => item(`p${index}`, { neighborhoodId: `B${index}` }))
      const near = new Set(items.slice(from, from + 4).map((entry) => entry.row.id))
      const likes = ['l0', 'l1', 'l2']
      return personalize(items, {
        liked: likes.map((id) => likedPlace(id)),
        pairs: Object.fromEntries(likes.map((a) => [a, Object.fromEntries(likes.map((b) => [b, 1]))])),
        df: {},
        total: 1000,
        rows: items.map((entry) => ({ id: entry.row.id, byLike: Object.fromEntries(likes.map((id) => [id, near.has(entry.row.id) ? 0.9 : 0.1])) })),
      }, likes, { grouped: true, lang: 'es' })
    }
    const profileIds = (result: ReturnType<typeof profileAt>) => result.groups.find((group) => group.id === 'profile')?.items.map((entry) => entry.row.id) ?? null
    expect(profileIds(profileAt(46))).toEqual(['p46', 'p47', 'p48', 'p49'])
    // Puestos 48 a 51: sólo 3 entran (48, 49, 50).
    expect(profileIds(profileAt(47))).toEqual(['p47', 'p48', 'p49'])
    expect(profileIds(profileAt(48))).toBeNull()
  })

  it('cada ícono está en exactamente una familia', () => {
    const all = Object.values(ICON_FAMILIES).flat()
    expect([...all].sort()).toEqual([...ICON_CATEGORY_KEYS].sort())
  })
})

describe('sin grupos: "Para vos"', () => {
  // Un plato vuelve específica la búsqueda: todos tienen pizza.
  const withPizza = () => basePlaces().map(({ place, vector }) => ({ place: { ...place, tags: [...place.tags, 'pizza'] }, vector }))

  it('de 3 a 4 lugares de la misma búsqueda, sin los que te gustaron; results no cambia', async () => {
    // Cada parrilla en su barrio: si no, la variedad por barrio deja 3.
    const places = withPizza().map(({ place, vector }) => ({ place: { ...place, neighborhoodId: `B${place.id}` }, vector }))
    const { search } = setup([...places, grill(5, { tags: ['picada', 'groups', 'pizza'], neighborhoodId: 'Bg5' })])
    const without = await search('pizza')
    const response = await search('pizza', { likes: ['g0', 'g1'] })
    expect(response.sections).toBeNull()
    expect(response.forYou).toMatchObject({ id: 'for_you', title: 'Para vos', total: null })
    expect(response.forYou!.placeIds).toHaveLength(4)
    expect(response.forYou!.placeIds.every((id) => ['g2', 'g3', 'g4', 'g5'].includes(id))).toBe(true)
    expect(response.results.map((result) => result.id)).toEqual(without.results.map((result) => result.id))
  })

  it('con 1 like del tipo no hay "Para vos"', async () => {
    const { search } = setup(withPizza())
    const response = await search('pizza', { likes: ['g0'] })
    expect(response.forYou).toBeNull()
  })

  it('sólo elige resultados "has": los que quizás tienen el plato ("maybe") no entran', async () => {
    // Las parrillas parecidas al perfil sólo tienen el tag milanesa (maybe); los demás tienen el plato (has).
    const places = basePlaces().map(({ place, vector }) => ({
      place: place.id.startsWith('g') && Number(place.id.slice(1)) >= 2 ? { ...place, tags: [...place.tags, 'milanesa'] } : { ...place, dishes: ['milanesa napolitana'] },
      vector,
    }))
    const { search } = setup(places)
    const response = await search('milanesa napolitana', { likes: ['g0', 'g1'] })
    expect(response.results.filter((result) => result.matchLevel === 'maybe').map((result) => result.id).sort()).toEqual(['g2', 'g3', 'g4'])
    expect(response.forYou).toBeNull()
    expect(response.debug?.personal.groups.find((group) => group.id === 'for_you')?.reason).toMatch(/^0 resultados "has"/)
  })

  it('con menos de 12 resultados "has" no hay bloques personales; desde 12, sí', async () => {
    const few = await setup(withPizza().slice(0, 11)).search('pizza', { likes: ['g0', 'g1'] })
    expect(few.forYou).toBeNull()
    expect(few.debug?.personal.skipped).toBe('11 resultados "has" (mínimo 12)')
    const enough = await setup(withPizza().slice(0, 12)).search('pizza', { likes: ['g0', 'g1'] })
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
      expect(result.sections?.[0]).toEqual({ id: 'diet', title: 'Recomendados', placeIds: ['p19', 'p20', 'p21'], total: null })
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
      expect(result.sections?.[0]).toEqual({ id: 'diet', title: 'Recomendados', placeIds: ['p19', 'p20'], total: null })
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
      expect(result.sections?.[0]).toMatchObject({ id: 'diet', title: 'Recomendados', placeIds: ['p19', 'p20', 'p21'] })
    })

    it('sin dieta (o con más de una) no hay grupo', () => {
      const result = buildSections(build([19, 20, 21]), [...requested], 'es')
      expect(result.sections?.some((section) => section.id === 'diet')).toBe(false)
      expect(result.diet).toBeNull()
    })
  })
})

describe('perfiles por tipo, afinidad, motivo y variedad', () => {
  const item = (id: string, overrides: Partial<CandidateRow> = {}): Collapsed => ({
    row: row({ id, name: id, iconCategory: 'coffee', categories: ['cafe'], style: null, price: 'unknown', neighborhoodId: `B${id}`, ...overrides }),
    pinned: false, matchLevel: 'has', dishLevel: 'has', open: null, rrf: 1, boosts: {}, baseScore: 1, multiplier: 1, score: 1, positionWithoutQuality: 1, branches: [],
  })
  const cafeLike = (id: string, overrides: Partial<LikedPlace> = {}) => likedPlace(id, { iconCategory: 'coffee', categories: ['cafe'], price: 'unknown', ...overrides })
  const barLike = (id: string, overrides: Partial<LikedPlace> = {}) => likedPlace(id, { iconCategory: 'beer', categories: ['bar'], price: 'unknown', ...overrides })
  /**
   * personalize con likes que no salen en la búsqueda (sin "Parecido a"): similarity(lugar, like) da el coseno; los likes
   * del mismo tipo son idénticos entre sí (coseno 1) y los de otro tipo, ortogonales.
   */
  const run = (
    items: Collapsed[],
    likes: LikedPlace[],
    similarity: (id: string, like: LikedPlace) => number,
    context: { intent?: IntentId | null; grouped?: boolean; home?: boolean; df?: Record<string, number> } = {},
  ) =>
    personalize(items, {
      liked: likes,
      pairs: Object.fromEntries(likes.map((a) => [a.id, Object.fromEntries(likes.map((b) => [b.id, placeKind(a) === placeKind(b) ? 1 : 0]))])),
      df: context.df ?? {},
      total: 1000,
      rows: items.map((entry) => ({ id: entry.row.id, byLike: Object.fromEntries(likes.map((like) => [like.id, similarity(entry.row.id, like)])) })),
    }, likes.map((like) => like.id), { grouped: context.grouped ?? true, lang: 'es', intent: context.intent ?? null, home: context.home })
  const groupOf = (result: ReturnType<typeof run>, id = 'profile') => result.groups.find((group) => group.id === id) ?? null
  const ids = (result: ReturnType<typeof run>, id = 'profile') => groupOf(result, id)?.items.map((entry) => entry.row.id) ?? null
  const groupDebug = (result: ReturnType<typeof run>, id = 'profile') => result.debug.groups.find((group) => group.id === id)!

  // 6 cafés y 6 bares; cada uno se parece 0,9 a los likes de su tipo y 0,3 a los otros.
  const mixed = () => [...Array.from({ length: 6 }, (_, index) => item(`c${index}`)), ...Array.from({ length: 6 }, (_, index) => item(`b${index}`, { iconCategory: 'beer', categories: ['bar'] }))]
  const byKind = (id: string, like: LikedPlace) => (id.startsWith('c') === (like.iconCategory === 'coffee') ? 0.9 : 0.3)
  const mixedLikes = [cafeLike('lc0'), cafeLike('lc1'), barLike('lb0'), barLike('lb1')]

  it('el tipo de un lugar: por la familia del ícono o, sin ícono, por sus categorías', () => {
    expect(placeKind({ iconCategory: 'croissant', categories: ['bakery'] })).toBe('cafes')
    expect(placeKind({ iconCategory: 'cocktails', categories: ['restaurant'] })).toBe('bars')
    expect(placeKind({ iconCategory: 'ice_cream', categories: [] })).toBe('desserts')
    expect(placeKind({ iconCategory: 'grill', categories: ['cafe'] })).toBe('eat')
    expect(placeKind({ iconCategory: null, categories: ['restaurant', 'cafe'] })).toBe('cafes')
    expect(placeKind({ iconCategory: null, categories: ['restaurant'] })).toBe('eat')
    expect(placeKind({ iconCategory: null, categories: [] })).toBeNull()
  })

  it('likes mixtos: cada búsqueda usa el perfil de su tipo y sólo elige lugares de ese tipo', () => {
    const cafes = run(mixed(), mixedLikes, byKind, { intent: 'cafes' })
    expect(cafes.debug.profiles.map((profile) => [profile.kind, profile.likes])).toEqual([['cafes', ['lc0', 'lc1']], ['bars', ['lb0', 'lb1']]])
    expect(cafes.debug.active).toEqual({ kind: 'cafes', reason: 'intención cafes' })
    expect(ids(cafes)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5'])
    const bars = run(mixed(), mixedLikes, byKind, { intent: 'bars' })
    expect(ids(bars)).toEqual(['b0', 'b1', 'b2', 'b3', 'b4', 'b5'])
    // Sin perfil de comer: nada.
    const eat = run(mixed(), mixedLikes, byKind, { intent: 'eat' })
    expect(ids(eat)).toBeNull()
    expect(groupDebug(eat).reason).toBe('sin perfil de eat (0 likes, mínimo 2)')
  })

  it('un lugar de otro tipo no entra aunque se parezca al perfil', () => {
    const result = run(mixed(), mixedLikes, (id, like) => (id === 'b0' ? 0.95 : byKind(id, like)), { intent: 'cafes' })
    expect(ids(result)).not.toContain('b0')
    expect(groupDebug(result).skipped).toContainEqual({ id: 'b0', name: 'b0', reason: 'otro tipo (bars)' })
  })

  it('sin intención: el tipo con la mitad de los primeros 30 "has"; si ninguno llega, no hay perfil', () => {
    // 8 cafés y 4 bares: cafés.
    const mostlyCafes = [...Array.from({ length: 8 }, (_, index) => item(`c${index}`)), ...mixed().slice(6, 10)]
    const result = run(mostlyCafes, mixedLikes, byKind)
    expect(result.debug.active).toEqual({ kind: 'cafes', reason: 'dominante cafes: 67 % de los primeros 12' })
    expect(groupOf(result)?.items.every((entry) => entry.row.id.startsWith('c'))).toBe(true)
    // 5 cafés, 5 bares y 2 pastas: ninguno llega a la mitad.
    const spread = [...mixed().slice(0, 5), ...mixed().slice(6, 11), item('p0', { iconCategory: 'pasta' }), item('p1', { iconCategory: 'pasta' })]
    const none = run(spread, mixedLikes, byKind)
    expect(none.debug.active.kind).toBeNull()
    expect(ids(none)).toBeNull()
    expect(groupDebug(none).reason).toMatch(/^sin tipo dominante/)
  })

  it('"Para vos" también usa el perfil del tipo', () => {
    const result = run(mixed(), mixedLikes, byKind, { intent: 'bars', grouped: false })
    expect(result.forYou?.title).toBe('Para vos')
    expect(result.forYou?.items.map((entry) => entry.row.id)).toEqual(['b0', 'b1', 'b2', 'b3'])
  })

  it('home: "Para vos" con el perfil con más likes, de 4 a 8 lugares y sin grupos', () => {
    // 3 likes de bares y 2 de cafés: bares, aunque la "búsqueda" (sin texto) no elija tipo.
    const likes = [cafeLike('lc0'), cafeLike('lc1'), barLike('lb0'), barLike('lb1'), barLike('lb2')]
    const many = [...mixed(), ...Array.from({ length: 6 }, (_, index) => item(`b${index + 6}`, { iconCategory: 'beer', categories: ['bar'] }))]
    const result = run(many, likes, byKind, { home: true })
    expect(result.debug.active).toEqual({ kind: 'bars', reason: 'home: el perfil con más likes (bars, 3)' })
    expect(result.groups).toEqual([])
    expect(result.forYou?.title).toBe('Para vos')
    // Como mucho 3 por barrio: cada bar está en su barrio, así que llega a 8.
    expect(result.forYou?.items).toHaveLength(8)
    expect(result.forYou?.items.every((entry) => entry.row.id.startsWith('b'))).toBe(true)
    // Con menos de 4 por encima del umbral, no hay fila.
    const few = run([...mixed().slice(0, 6), ...mixed().slice(6, 9)], likes, byKind, { home: true })
    expect(few.forYou).toBeNull()
  })

  it('home: si empatan, el tipo del like más reciente; sin perfil, nada', () => {
    const profiles = [
      { kind: 'cafes' as const, likes: [{ id: 'c1' }, { id: 'c2' }] },
      { kind: 'bars' as const, likes: [{ id: 'b1' }, { id: 'b2' }] },
    ]
    expect(mostLikedKind(profiles, ['b2', 'c1', 'c2', 'b1']).kind).toBe('bars')
    expect(mostLikedKind(profiles, ['c2', 'b2', 'c1', 'b1']).kind).toBe('cafes')
    expect(mostLikedKind([], ['x']).kind).toBeNull()
  })

  describe('variedad', () => {
    const likes = [cafeLike('l0'), cafeLike('l1')]
    // El parecido baja con el orden: a mayor índice, menos parecido.
    const ranked = (items: Collapsed[]) => (id: string) => 0.95 - items.findIndex((entry) => entry.row.id === id) * 0.01

    it('como mucho 2 de la misma familia de ícono; sin otras familias, completa con los salteados', () => {
      const items = [
        ...Array.from({ length: 5 }, (_, index) => item(`c${index}`)),
        item('k0', { iconCategory: 'croissant', categories: ['bakery'] }),
        item('k1', { iconCategory: 'bread', categories: ['bakery'] }),
        item('d0', { iconCategory: 'breakfast' }),
      ]
      const result = run(items, likes, ranked(items), { intent: 'cafes' })
      // Primero las otras familias; el sexto lugar, ya sin alternativas, es el siguiente café.
      expect(ids(result)).toEqual(['c0', 'c1', 'k0', 'k1', 'd0', 'c2'])
      expect(groupDebug(result).rule).toBe('familia')
      expect(groupDebug(result).skipped.map((place) => [place.id, place.reason])).toEqual([
        ['c3', 'ya hay 2 de la familia coffee'],
        ['c4', 'ya hay 2 de la familia coffee'],
      ])
    })

    it('todos de la misma familia: como mucho 3 por barrio y una sucursal por marca', () => {
      const items = [
        ...Array.from({ length: 4 }, (_, index) => item(`p${index}`, { neighborhoodId: 'POCITOS' })),
        item('m0', { brandKey: 'marca', brandCount: 2 }),
        item('m1', { brandKey: 'marca', brandCount: 2 }),
        item('x0'),
        item('x1'),
      ]
      const result = run(items, likes, ranked(items), { intent: 'cafes' })
      expect(groupDebug(result).rule).toBe('barrio+marca')
      expect(ids(result)).toEqual(['p0', 'p1', 'p2', 'm0', 'x0', 'x1'])
      expect(groupDebug(result).skipped.map((place) => [place.id, place.reason])).toEqual([
        ['p3', 'ya hay 3 en POCITOS'],
        ['m1', 'otra sucursal de marca'],
      ])
    })

    it('sin alternativas, completa hasta el mínimo con los salteados', () => {
      const items = Array.from({ length: 4 }, (_, index) => item(`m${index}`, { brandKey: 'marca', brandCount: 3 }))
      const result = run(items, likes, ranked(items), { intent: 'cafes' })
      expect(ids(result)).toEqual(['m0', 'm1', 'm2'])
    })

    it('las cadenas (4 sucursales o más) no entran en los grupos personales', () => {
      const items = [...Array.from({ length: 4 }, (_, index) => item(`c${index}`)), item('chain', { brandKey: 'grande', brandCount: 4 })]
      const result = run(items, likes, () => 0.9, { intent: 'cafes' })
      expect(ids(result)).not.toContain('chain')
      expect(groupDebug(result).skipped).toContainEqual({ id: 'chain', name: 'chain', reason: 'cadena (4 sucursales)' })
    })
  })

  describe('afinidad y motivo', () => {
    // Vermut y de barrio son raros en la base; cena la tiene casi todo; el barrio y el precio son comunes (idf < 0,2).
    const df = { vermouth: 30, neighborhood_spot: 80, dinner: 900, 'price:moderate': 400, 'barrio:CENTRO': 300 }
    const tags = ['vermouth', 'neighborhood_spot', 'dinner']
    const likes = ['l0', 'l1', 'l2'].map((id) => barLike(id, { tags, price: 'moderate' }))
    const bar = (id: string, overrides: Partial<CandidateRow> = {}) => item(id, { iconCategory: 'beer', categories: ['bar'], ...overrides })

    it('pesa lo que se repite y es raro en la base: cena no cuenta', () => {
      const traits = profileTraits(likes, df, 1000)
      expect(traits.map((trait) => trait.key)).toEqual(['vermouth', 'neighborhood_spot'])
      expect(traits[0]).toMatchObject({ share: 1, k: 1, idf: expect.closeTo(Math.log(1000 / 30) / Math.log(1000), 6) })
      // Un rasgo de un solo like no se repite.
      expect(profileTraits([...likes.slice(0, 1), barLike('l9')], df, 1000)).toEqual([])
      // Un barrio raro sí cuenta, con la mitad del peso.
      expect(profileTraits(likes, { ...df, 'barrio:CENTRO': 20 }, 1000).find((trait) => trait.key === 'barrio:CENTRO')).toMatchObject({ k: 0.5 })
    })

    it('el título dice los 1–2 rasgos de más peso que tiene la mitad de los elegidos', () => {
      const items = Array.from({ length: 4 }, (_, index) => bar(`b${index}`, { tags: ['vermouth', 'neighborhood_spot', 'dinner'] }))
      const result = run(items, likes, () => 0.8, { intent: 'bars', df })
      expect(groupOf(result)?.title).toBe('Porque te gustan los bares de barrio con vermut')
      expect(groupDebug(result).titleTraits).toEqual(['vermouth', 'neighborhood_spot'])
      expect(groupDebug(result).places[0]).toMatchObject({ similarity: expect.closeTo(0.8, 6), affinity: 1, traits: ['vermouth', 'neighborhood_spot'] })
    })

    it('sin rasgos compartidos por los elegidos, "Porque te gustan estos bares"', () => {
      const items = Array.from({ length: 4 }, (_, index) => bar(`b${index}`))
      const result = run(items, likes, () => 0.8, { intent: 'bars', df })
      expect(groupOf(result)?.title).toBe('Porque te gustan estos bares')
    })

    it('con parecido 0,70, entra si comparte los rasgos y no entra si no', () => {
      const items = [
        ...Array.from({ length: 3 }, (_, index) => bar(`b${index}`)),
        bar('with', { tags: ['vermouth', 'neighborhood_spot'], neighborhoodId: 'CENTRO' }),
        bar('without'),
      ]
      const result = run(items, likes, (id) => (id === 'with' || id === 'without' ? 0.7 : 0.8), { intent: 'bars', df })
      expect(ids(result)).toContain('with')
      expect(ids(result)).not.toContain('without')
    })

    it('cada tag del catálogo (y el style y el precio) se puede decir en el motivo', () => {
      const groups = Object.entries(ALL_GROUPS).filter(([name]) => name !== 'categories' && name !== 'style')
      const missing = groups.flatMap(([, group]) => Object.keys(group).filter((key) => !traitPhrase(key)?.text))
      expect(missing).toEqual([])
      for (const key of ['style:casual', 'style:cuidado', 'price:low', 'price:moderate', 'price:high', 'barrio:POCITOS']) expect(traitPhrase(key)?.text).toBeTruthy()
      expect(traitPhrase('barrio:POCITOS')?.text).toBe('en Pocitos')
      expect(profileReasonTitle('cafes', ['quiet', 'specialty_coffee'], 'es')).toBe('Porque te gustan los cafés tranquilos con café de especialidad')
      expect(profileReasonTitle('eat', ['japanese', 'barrio:CORDON'], 'es')).toBe('Porque te gustan los restaurantes de cocina japonesa en Cordón')
      expect(profileReasonTitle('bars', ['craft_beer', 'draft_beer'], 'es')).toBe('Porque te gustan los bares con cerveza artesanal y cerveza tirada')
    })
  })
})
