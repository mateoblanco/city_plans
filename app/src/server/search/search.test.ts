import { describe, expect, it } from 'vitest'
import { SEARCH_CONFIG } from './config'
import { dishTarget } from './dishes'
import { buildRankings, fuse, qualityMultiplier, reciprocalRankFusion, type FuseContext } from './fuse'
import { buildChips } from './chips'
import { emptyInterpretation } from './interpretation'
import { noMatchNotice } from './relax'
import { memoryCache } from './cache'
import { runSearch } from './search'
import { everyDay, fakeCache, fakeStore, llmOutput, row } from './test/fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], openAt: null, wantsBest: false, ...overrides,
})

describe('fusión', () => {
  it('RRF con k = 60 suma 1 / (k + puesto) por ranking', () => {
    const scores = reciprocalRankFusion({
      semantic: [{ id: 'a', name: 'a', score: 0.9 }, { id: 'b', name: 'b', score: 0.8 }],
      keyword: [{ id: 'b', name: 'b', score: 0.5 }],
      name: [],
      distance: [],
      quality: [],
    })
    expect(scores.get('a')).toBeCloseTo(1 / 61)
    expect(scores.get('b')).toBeCloseTo(1 / 62 + 1 / 61)
  })

  it('aplica los empujones de config y ordena por puntaje', () => {
    const rows = [
      row({ id: 'plain', semantic: 0.9 }),
      row({ id: 'boosted', semantic: 0.8, categories: ['cafe'], tags: ['quiet'], signature: ['quiet'] }),
    ]
    const fused = fuse(rows, buildRankings(rows), context({ categories: ['cafe'], requestedTags: ['quiet'], preferTags: ['quiet'] }))
    expect(fused.map((item) => item.row.id)).toEqual(['boosted', 'plain'])
    expect(fused[0].boosts).toEqual({
      category: SEARCH_CONFIG.boosts.category,
      signature: SEARCH_CONFIG.boosts.signature,
      preferTag: SEARCH_CONFIG.boosts.preferTag,
    })
  })

  it('platos en dos niveles: lo tiene antes que puede que tenga, aunque puntúe menos', () => {
    const dishes = [dishTarget('milanesa napolitana')]
    const rows = [
      row({ id: 'tag-only', semantic: 0.99, tags: ['milanesa'], dishHas: [false], dishExact: [false] }),
      row({ id: 'has-it', semantic: 0.1, dishes: ['milanesa napolitana'], dishHas: [true], dishExact: [true] }),
    ]
    const fused = fuse(rows, buildRankings(rows), context({ dishes }))
    expect(fused.map((item) => [item.row.id, item.matchLevel])).toEqual([['has-it', 'has'], ['tag-only', 'maybe']])
    expect(fused[0].boosts.exactDish).toBe(SEARCH_CONFIG.boosts.exactDish)
  })

  it('con openAt los confirmados abiertos van antes que los no confirmados; el fijado por nombre siempre primero', () => {
    const rows = [
      row({ id: 'unconfirmed', semantic: 0.99 }),
      row({ id: 'open', semantic: 0.1, hours: everyDay('09:00', '18:00') }),
      row({ id: 'pinned', semantic: 0.05, matchesFilters: false }),
    ]
    const fused = fuse(rows, buildRankings(rows), context({ pinnedId: 'pinned', openAt: { day: 1, time: '13:00' } }))
    expect(fused.map((item) => item.row.id)).toEqual(['pinned', 'open', 'unconfirmed'])
    expect(fused[1].boosts.confirmedOpen).toBe(SEARCH_CONFIG.boosts.confirmedOpen)
  })
})

describe('calidad', () => {
  const { normal, best } = SEARCH_CONFIG.quality

  it('multiplicador lineal en prominence, con un extra por featured', () => {
    expect(qualityMultiplier({ prominence: 0, featured: false }, false)).toBeCloseTo(normal.prominenceMin)
    expect(qualityMultiplier({ prominence: 1, featured: false }, false)).toBeCloseTo(normal.prominenceMax)
    expect(qualityMultiplier({ prominence: 0.5, featured: true }, false)).toBeCloseTo(((normal.prominenceMin + normal.prominenceMax) / 2) * normal.featured)
    expect(qualityMultiplier({ prominence: 1, featured: true }, true)).toBeCloseTo(best.prominenceMax * best.featured)
  })

  it('con relevancia parecida gana el de más calidad, y debug muestra la posición sin calidad', () => {
    const rows = [row({ id: 'plain', semantic: 0.9 }), row({ id: 'prominent', semantic: 0.8, prominence: 1 })]
    const fused = fuse(rows, buildRankings(rows), context())
    expect(fused.map((item) => [item.row.id, item.positionWithoutQuality])).toEqual([['prominent', 2], ['plain', 1]])
    expect(fused[0].multiplier).toBeCloseTo(normal.prominenceMax)
    expect(fused[0].score).toBeCloseTo(fused[0].baseScore * normal.prominenceMax)
  })

  it('un lugar poco relevante no le gana a uno muy relevante, aunque sea featured', () => {
    const rows = [
      row({ id: 'relevant', semantic: 0.9, keyword: 0.5, nameScore: 0.9 }),
      row({ id: 'famous', semantic: 0.8, prominence: 1, featured: true }),
    ]
    const fused = fuse(rows, buildRankings(rows), context({ wantsBest: true }))
    expect(fused.map((item) => item.row.id)).toEqual(['relevant', 'famous'])
  })

  it('pedir lo mejor amplía el rango', () => {
    const rows = [row({ id: 'plain', semantic: 0.9, tags: ['quiet'] }), row({ id: 'prominent', semantic: 0.8, prominence: 1 })]
    const order = (wantsBest: boolean) => fuse(rows, buildRankings(rows), context({ preferTags: ['quiet'], wantsBest })).map((item) => item.row.id)
    expect(order(false)).toEqual(['plain', 'prominent'])
    expect(order(true)).toEqual(['prominent', 'plain'])
  })

  it('no cruza niveles: "puede que tenga" sigue después de "lo tiene"', () => {
    const dishes = [dishTarget('milanesa napolitana')]
    const rows = [
      row({ id: 'tag-only', semantic: 0.9, tags: ['milanesa'], dishHas: [false], dishExact: [false], prominence: 1, featured: true }),
      row({ id: 'has-it', semantic: 0.8, dishHas: [true], dishExact: [false] }),
    ]
    const fused = fuse(rows, buildRankings(rows), context({ dishes, wantsBest: true }))
    expect(fused.map((item) => item.row.id)).toEqual(['has-it', 'tag-only'])
  })
})

describe('runSearch', () => {
  const places = [
    row({ id: 'cafe-cordon', name: 'Café del Cordón', categories: ['cafe'], tags: ['terrace'], hours: everyDay('08:00', '20:00'), diet: { vegan: 'has_options', vegetarian: 'unknown', glutenFree: 'unknown' } }),
    row({ id: 'cafe-rodo', name: 'Café Rodó', neighborhoodId: 'PARQUE RODO', categories: ['cafe'], distance: 500 }),
    row({ id: 'pizzeria', name: 'Pizzería', categories: ['pizzeria', 'restaurant'], tags: ['pizza'], hours: everyDay('19:00', '01:00') }),
    row({ id: 'bodegon', name: 'Bodegón', categories: ['restaurant'], tags: ['milanesa'], dishes: ['milanesa napolitana'], diet: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'fully' } }),
  ]

  it('usa el atajo sin llamar al modelo', async () => {
    const { store } = fakeStore(places)
    const { cache, interpreted } = fakeCache()
    const response = await runSearch('Cafés en Cordón', { store, cache }, { now, debug: true })
    expect(interpreted).toEqual([])
    expect(response.debug?.source).toBe('shortcut')
    expect(response.results.map((result) => result.id)).toEqual(['cafe-cordon'])
    expect(response.interpreted.chips).toEqual([
      { kind: 'category', id: 'cafe', label: 'Café', fromText: true, fromFilter: false },
      { kind: 'neighborhood', id: 'CORDON', label: 'Cordón', fromText: true, fromFilter: false },
    ])
    expect(response.results[0].reasons).toEqual(['Café', 'Abierto · cierra 20:00', 'Cordón'])
  })

  it('"los mejores" amplía la calidad sin chip ni filtro; featured suma "Recomendado"', async () => {
    const withFeatured = places.map((place) => (place.id === 'cafe-rodo' ? { ...place, featured: true } : place))
    const { store } = fakeStore(withFeatured)
    const { cache, interpreted } = fakeCache()
    const response = await runSearch('los mejores cafés', { store, cache }, { now, debug: true })
    expect(interpreted).toEqual([])
    expect(response.debug?.interpretation.wantsBest).toBe(true)
    expect(response.debug?.interpretation.unrecognized).toEqual([])
    expect(response.debug?.keywords).not.toContain('mejores')
    expect(response.interpreted.chips).toEqual([{ kind: 'category', id: 'cafe', label: 'Café', fromText: true, fromFilter: false }])
    const rodo = response.debug?.results.find((result) => result.id === 'cafe-rodo')
    expect(rodo).toMatchObject({ featured: true, prominence: 0 })
    expect(rodo?.multiplier).toBeCloseTo(SEARCH_CONFIG.quality.best.prominenceMin * SEARCH_CONFIG.quality.best.featured)
    expect(response.results.find((result) => result.id === 'cafe-rodo')?.reasons[0]).toBe('Recomendado')
    expect(response.results.find((result) => result.id === 'cafe-cordon')?.reasons).not.toContain('Recomendado')
  })

  it('"best" en inglés: "Recommended"', async () => {
    const withFeatured = places.map((place) => (place.id === 'cafe-rodo' ? { ...place, featured: true } : place))
    const { store } = fakeStore(withFeatured)
    const response = await runSearch('best cafe in pocitos', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.source).toBe('shortcut')
    expect(response.debug?.interpretation.wantsBest).toBe(true)
    expect(response.results.find((result) => result.id === 'cafe-rodo')?.reasons[0]).toBe('Recommended')
  })

  it('debug suma lo que cobró el Gateway; lo que vino de la cache cuenta 0', async () => {
    const { store } = fakeStore(places)
    const fresh = await runSearch('algo rico para hoy', { store, cache: fakeCache(llmOutput(), { cost: 0.001 }).cache }, { now, debug: true })
    expect(fresh.debug?.cost.calls).toEqual([
      { step: 'embed', model: 'test-embedding', usd: 0.00001, cached: false },
      { step: 'interpret', model: 'test-model', usd: 0.001, cached: false },
    ])
    expect(fresh.debug?.cost.totalUsd).toBeCloseTo(0.00101)

    const cached = await runSearch('algo rico para hoy', { store, cache: fakeCache(llmOutput(), { cost: 0.001, computedAt: 0 }).cache }, { now, debug: true })
    expect(cached.debug?.cost.calls.every((call) => call.cached)).toBe(true)
    expect(cached.debug?.cost.totalUsd).toBe(0)

    // El atajo no llama al modelo: sólo el embedding.
    const shortcut = await runSearch('cafés en cordón', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(shortcut.debug?.cost.calls.map((call) => call.step)).toEqual(['embed'])
  })

  it('usa el modelo cuando el atajo no alcanza y valida lo que devuelve', async () => {
    const { store } = fakeStore(places)
    const { cache, interpreted } = fakeCache(llmOutput({ exclude: { categories: ['pizzeria'], tags: ['pizza', 'no_existe'] } }))
    const response = await runSearch('algo que no sea pizza', { store, cache }, { now, debug: true })
    expect(interpreted).toEqual(['algo que no sea pizza'])
    expect(response.debug?.source).toBe('llm')
    expect(response.debug?.discarded).toEqual(['no_existe'])
    expect(response.results.map((result) => result.id)).not.toContain('pizzeria')
    // Las palabras de lo excluido no se buscan por keyword.
    expect(response.debug?.keywords).not.toContain('pizza')
  })

  it('si el modelo falla sigue sin avisar: el texto tal cual para nombre, palabras y embedding', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, embedded } = fakeCache(new Error('timeout'))
    const response = await runSearch('lugar raro', { store, cache }, { now, debug: true })
    expect(response.debug?.source).toBe('fallback')
    expect(response.debug?.llmError).toBe('timeout')
    expect(response.results).toHaveLength(places.length)
    expect(response.relaxed).toEqual([])
    expect(response.interpreted.chips).toEqual([])
    expect(embedded).toEqual(['lugar raro'])
    expect(calls[0].scores).toMatchObject({ name: 'lugar raro', keywords: ['raro'] })
  })

  it('si el modelo falla, toma del diccionario lo que reconoce e ignora lo negado', async () => {
    const { store } = fakeStore(places)
    const { cache } = fakeCache(new Error('timeout'))
    const response = await runSearch('cafecito rico en cordon que no sea pizza', { store, cache }, { now, debug: true })
    expect(response.debug?.source).toBe('fallback')
    expect(response.interpreted.chips.map((chip) => `${chip.kind}:${chip.id}`)).toEqual(['neighborhood:CORDON'])
    expect(response.results.map((result) => result.id)).not.toContain('cafe-rodo')
  })

  it('un nombre fuerte va primero y evita el modelo', async () => {
    const { store } = fakeStore(places, [{ id: 'bodegon', name: 'Bodegón', similarity: 0.9, wordSimilarity: 1 }])
    const { cache, interpreted } = fakeCache()
    const response = await runSearch('el mingus', { store, cache }, { now, debug: true })
    expect(interpreted).toEqual([])
    expect(response.debug?.source).toBe('name')
    expect(response.results[0].id).toBe('bodegon')
  })

  it('un nombre parecido no gana cuando el diccionario resolvió la consulta', async () => {
    const { store } = fakeStore(places, [{ id: 'pizzeria', name: 'Pizzería', similarity: 0.6, wordSimilarity: 1 }])
    const response = await runSearch('pizzería', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.source).toBe('shortcut')
    expect(response.debug?.results[0].pinned).toBe(false)
  })

  it('platos: "Tiene" antes que "Puede que tengan"', async () => {
    const withTagOnly = [...places, row({ id: 'parrilla', tags: ['milanesa'] })]
    const { store } = fakeStore(withTagOnly)
    const response = await runSearch('milanesa napolitana', { store, cache: fakeCache().cache }, { now })
    expect(response.results.map((result) => [result.id, result.matchLevel])).toEqual([['bodegon', 'has'], ['parrilla', 'maybe']])
    expect(response.results[0].reasons[0]).toBe('Tiene milanesa napolitana')
    expect(response.results[1].reasons[0]).toBe('Puede que tengan milanesa napolitana')
  })

  it('relaja en orden: tags de must a prefer, barrio (ordenando por distancia) y openAt', async () => {
    // Con horario confirmado los dos cafés están cerrados a las 23, así que hace falta relajar openAt.
    const confirmed = places.map((place) => (place.id === 'cafe-rodo' ? { ...place, hours: everyDay('08:00', '18:00') } : place))
    const { store, calls } = fakeStore(confirmed)
    const { cache } = fakeCache(
      llmOutput({ must: { categories: ['cafe'], tags: ['live_music'], diet: { vegan: false, vegetarian: false, glutenFree: false }, neighborhoods: ['Pocitos'], price: [], openAt: { now: false, day: 1, time: '23:00' } } }),
    )
    const response = await runSearch('cafe con musica en pocitos a las 23', { store, cache }, { now })
    expect(calls.map((call) => [call.filters.tags.length, call.filters.neighborhoods.length, call.filters.openAt !== null])).toEqual([
      [1, 1, true],
      [0, 1, true],
      [0, 0, true],
      [0, 0, false],
    ])
    expect(calls[2].scores.origins).toHaveLength(1)
    // Las categorías no se relajan antes del último recurso.
    expect(calls[3].filters.categories).toEqual(['cafe'])
    expect(response.relaxed.map((step) => step.what)).toEqual(['mustTags', 'neighborhood', 'openAt'])
    expect(response.relaxed[0].message).toBe('No todos los lugares tienen música en vivo: pasó a ser una preferencia.')
    expect(response.results.map((result) => result.id).sort()).toEqual(['cafe-cordon', 'cafe-rodo'])
  })

  it('con los tags relajados se queda en el barrio pedido', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('cafe con terraza y musica en vivo en parque rodo', { store, cache: fakeCache().cache }, { now })
    expect(calls).toHaveLength(2)
    expect(calls[1].filters.neighborhoods).toEqual(['PARQUE RODO'])
    expect(response.results.map((result) => result.id)).toEqual(['cafe-rodo'])
  })

  it('el aviso sólo nombra lo que de verdad no se cumple', async () => {
    const withBoth = [...places, row({ id: 'cafe-terraza', categories: ['cafe'], tags: ['terrace'], neighborhoodId: 'POCITOS' })]
    // Nadie tiene terraza y música; el único con terraza está en Pocitos: sólo se avisa de la música.
    const { store } = fakeStore(withBoth)
    const response = await runSearch('cafe con terraza y musica en vivo en pocitos', { store, cache: fakeCache().cache }, { now })
    expect(response.results.map((result) => result.id)).toEqual(['cafe-terraza'])
    expect(response.relaxed).toEqual([{ what: 'mustTags', message: 'No todos los lugares tienen música en vivo: pasó a ser una preferencia.' }])
  })

  it('un plato que nadie tiene se busca por sus tags relacionados, con aviso', async () => {
    const withPeruvian = [...places, row({ id: 'peruano', categories: ['restaurant'], tags: ['peruvian'] })]
    const { store, calls } = fakeStore(withPeruvian)
    const { cache } = fakeCache(llmOutput({ dishes: [{ name: 'ceviche', related: ['peruvian', 'seafood', 'inventado'] }] }))
    const response = await runSearch('ceviche', { store, cache }, { now, debug: true })
    expect(response.debug?.discarded).toEqual(['inventado'])
    expect(calls.map((call) => call.filters.dishMode)).toEqual(['dish', 'related'])
    expect(response.results.map((result) => [result.id, result.matchLevel])).toEqual([['peruano', 'maybe']])
    expect(response.results[0].reasons[0]).toBe('Cocina peruana')
    expect(response.relaxed).toEqual([{ what: 'dishRelated', message: 'No encontramos ceviche; estos tienen cocina peruana.' }])
  })

  it('sin plato ni tags relacionados muestra resultados por similitud', async () => {
    const { store, calls } = fakeStore(places)
    const { cache } = fakeCache(llmOutput({ dishes: [{ name: 'ceviche', related: ['peruvian'] }], must: { categories: ['restaurant'], tags: [], diet: { vegan: false, vegetarian: false, glutenFree: false }, neighborhoods: [], price: [], openAt: null } }))
    const response = await runSearch('ceviche', { store, cache }, { now })
    expect(calls.map((call) => call.filters.dishMode)).toEqual(['dish', 'related', 'none'])
    expect(calls[2].filters.categories).toEqual([])
    expect(response.results).toHaveLength(places.length)
    expect(response.relaxed.map((step) => step.what)).toEqual(['dishRelated', 'similarity'])
    expect(response.relaxed[0].message).toBe('No encontramos ceviche.')
    expect(response.suggestedRemovals).toEqual([])
  })

  it('nunca relaja la dieta ni los exclude; con cero dice qué bloquea y qué chips sacar', async () => {
    const { store, calls } = fakeStore(places)
    const { cache } = fakeCache(
      llmOutput({
        must: { categories: [], tags: [], diet: { vegan: true, vegetarian: false, glutenFree: true }, neighborhoods: ['Cordón'], price: [], openAt: null },
        exclude: { categories: ['cafe'], tags: [] },
      }),
    )
    const response = await runSearch('vegano y sin tacc que no sea cafe', { store, cache }, { now })
    expect(response.results).toEqual([])
    for (const call of calls) {
      expect(call.filters.diet).toEqual(['vegan', 'glutenFree'])
      expect(call.filters.excludeCategories).toEqual(['cafe'])
    }
    expect(response.relaxed).toEqual([{ what: 'noMatch', message: 'No encontramos lugares con opciones veganas y sin TACC confirmadas.' }])
    expect(response.suggestedRemovals).toEqual([
      { kind: 'diet', id: 'vegan', label: 'Vegano', fromText: true, fromFilter: false },
      { kind: 'diet', id: 'glutenFree', label: 'Sin TACC', fromText: true, fromFilter: false },
    ])
  })

  it('hay resultados siempre que existan publicados que cumplan dieta y exclude', async () => {
    const { store } = fakeStore(places)
    const { cache } = fakeCache(
      llmOutput({
        must: { categories: ['bar'], tags: ['karaoke'], diet: { vegan: true, vegetarian: false, glutenFree: false }, neighborhoods: ['Pocitos'], price: ['high'], openAt: { now: true, day: null, time: null } },
        dishes: [{ name: 'ceviche', related: [] }],
      }),
    )
    const response = await runSearch('bar vegano con karaoke y ceviche en pocitos abierto ahora', { store, cache }, { now })
    expect(response.results.map((result) => result.id)).toEqual(['cafe-cordon'])
    expect(response.relaxed.at(-1)?.what).toBe('similarity')
  })

  it('remove saca chips sin volver a interpretar distinto', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, embedded } = fakeCache()
    const response = await runSearch('cafes con terraza en cordon', { store, cache }, { now, remove: 'tag:terrace,neighborhood:CORDON' })
    expect(response.interpreted.chips.map((chip) => chip.kind)).toEqual(['category'])
    expect(calls[0].filters.tags).toEqual([])
    expect(calls[0].filters.neighborhoods).toEqual([])
    // El embedding usa lo que quedó, no la consulta original.
    expect(embedded).toEqual(['Café'])
    expect(response.results.map((result) => result.id).sort()).toEqual(['cafe-cordon', 'cafe-rodo'])
  })

  it('responde en inglés y pide ubicación con "near me"', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('vegan near me', { store, cache: fakeCache().cache }, { now })
    expect(response.needsLocation).toBe(true)
    expect(response.results[0].reasons).toEqual(['Vegan options', 'Open · closes 20:00', 'Cordón'])
  })

  it('cada resultado trae sus coordenadas para el mapa', async () => {
    const { store } = fakeStore([{ ...places[0], lat: -34.9, lng: -56.18 }])
    const response = await runSearch('Cafés en Cordón', { store, cache: fakeCache().cache }, { now })
    expect(response.results[0]).toMatchObject({ id: 'cafe-cordon', lat: -34.9, lng: -56.18 })
  })

  it('debug sólo cuando se pide', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('cafes', { store, cache: fakeCache().cache }, { now })
    expect(response.debug).toBeUndefined()
  })

  it('consulta vacía no consulta nada', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('  ¿? ', { store, cache: fakeCache().cache }, { now })
    expect(response.results).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('exclusiones', () => {
  const value = emptyInterpretation()
  value.must.diet = { vegan: true }
  value.exclude = { categories: ['restaurant', 'bar'], tags: ['pizza'] }

  it('los chips se leen como exclusión', () => {
    expect(buildChips(value, 1).filter((chip) => chip.kind === 'exclude').map((chip) => chip.label)).toEqual([
      'Excepto restaurantes',
      'Excepto bares',
      'Excepto pizza',
    ])
    expect(buildChips({ ...value, language: 'en' }, 1).find((chip) => chip.kind === 'exclude')?.label).toBe('Except restaurants')
  })

  it('el aviso de cero resultados nombra lo excluido igual que los chips', () => {
    expect(noMatchNotice(value, { diet: true, exclude: true }).message).toBe(
      'No encontramos lugares con opciones veganas confirmadas, excepto restaurantes, bares y pizza.',
    )
    expect(noMatchNotice(value, { diet: false, exclude: true }).message).toBe('No encontramos lugares excepto restaurantes, bares y pizza.')
    expect(noMatchNotice(value, { diet: true, exclude: false }).message).toBe('No encontramos lugares con opciones veganas confirmadas.')
  })
})

describe('barra de filtros y cerca mío', () => {
  const places = [
    row({ id: 'cafe-cordon', categories: ['cafe'], hours: everyDay('08:00', '20:00'), prominence: 0.3, distance: 400 }),
    row({ id: 'cafe-famoso', categories: ['cafe'], hours: everyDay('08:00', '20:00'), prominence: 0.9, distance: 2500 }),
    row({ id: 'cafe-sin-horario', categories: ['cafe'], prominence: 1, featured: true, distance: 4000 }),
    row({ id: 'cafe-pocitos', neighborhoodId: 'POCITOS', categories: ['cafe'], hours: everyDay('08:00', '20:00') }),
    row({ id: 'pizzeria-pocitos', neighborhoodId: 'POCITOS', categories: ['pizzeria'], tags: ['pizza'] }),
    row({ id: 'pizzeria-cordon', categories: ['pizzeria'], tags: ['pizza'] }),
  ]
  const ids = (response: { results: { id: string }[] }) => response.results.map((result) => result.id)

  it('los filtros se suman a lo interpretado sin volver a interpretar el texto', async () => {
    const { store } = fakeStore(places)
    const base = fakeCache(llmOutput({ must: { ...llmOutput().must, categories: ['pizzeria'] } }))
    const cache = memoryCache(base.cache)
    const plain = await runSearch('algo para ir con la familia', { store, cache }, { now })
    const filtered = await runSearch('algo para ir con la familia', { store, cache }, { now, filters: 'neighborhood:CORDON' })
    expect(base.interpreted).toEqual(['algo para ir con la familia'])
    expect(ids(plain).sort()).toEqual(['pizzeria-cordon', 'pizzeria-pocitos'])
    expect(ids(filtered)).toEqual(['pizzeria-cordon'])
    expect(filtered.interpreted.chips).toEqual([
      { kind: 'category', id: 'pizzeria', label: 'Pizzería', fromText: true, fromFilter: false },
      { kind: 'neighborhood', id: 'CORDON', label: 'Cordón', fromText: false, fromFilter: true },
    ])
  })

  it('si el texto dice un barrio y el filtro otro, gana el filtro', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('cafés en Pocitos', { store, cache: fakeCache().cache }, { now, filters: 'neighborhood:CORDON' })
    expect(response.interpreted.chips.map((chip) => chip.id)).toEqual(['cafe', 'CORDON'])
    expect(ids(response)).not.toContain('cafe-pocitos')
  })

  it('un chip que está en el texto y en la barra viene de los dos', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('cafés en Cordón', { store, cache: fakeCache().cache }, { now, filters: 'category:cafe' })
    expect(response.interpreted.chips[0]).toEqual({ kind: 'category', id: 'cafe', label: 'Café', fromText: true, fromFilter: true })
  })

  it('sólo con filtros: sin modelo ni embedding, por calidad y con los de horario sin confirmar abajo', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, interpreted, embedded } = fakeCache()
    const response = await runSearch('', { store, cache }, { now, filters: 'category:cafe,open:now', debug: true })
    expect(interpreted).toEqual([])
    expect(embedded).toEqual([])
    expect(response.debug?.source).toBe('filters')
    expect(calls[0].scores).toMatchObject({ embedding: null, keywords: [], name: null })
    expect(ids(response)).toEqual(['cafe-famoso', 'cafe-cordon', 'cafe-pocitos', 'cafe-sin-horario'])
    expect(response.interpreted.chips.map((chip) => [chip.kind, chip.fromFilter])).toEqual([['category', true], ['openAt', true]])
  })

  it('sin texto ni filtros no busca nada', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, filters: 'tag:inventado' })
    expect(response.results).toEqual([])
    expect(calls).toEqual([])
  })

  it('cerca mío: radio de 1,5 km, la distancia en los motivos y el chip', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, filters: 'category:cafe', near: '-34.90512,-56.18471' })
    expect(response.near).toEqual({ lat: -34.905, lng: -56.185 })
    expect(calls[0].filters.near).toEqual({ lat: -34.905, lng: -56.185, radiusM: 1500 })
    expect(calls[0].scores.origins).toEqual([{ lat: -34.905, lng: -56.185 }])
    expect(ids(response)).toEqual(['cafe-cordon'])
    expect(response.results[0].reasons).toContain('a 400 m')
    expect(response.interpreted.chips.at(-1)).toEqual({ kind: 'near', id: 'me', label: 'Cerca mío', fromText: false, fromFilter: false })
    expect(response.relaxed).toEqual([])
  })

  it('sin nada en 1,5 km amplía a 3 km y después a 5 km, avisando', async () => {
    const far = places.filter((place) => place.id !== 'cafe-cordon')
    const { store, calls } = fakeStore(far)
    const at3 = await runSearch('', { store, cache: fakeCache().cache }, { now, filters: 'category:cafe', near: '-34.9,-56.18' })
    expect(calls.map((call) => call.filters.near?.radiusM)).toEqual([1500, 3000])
    expect(ids(at3)).toEqual(['cafe-famoso'])
    expect(at3.results[0].reasons).toContain('a 2,5 km')
    expect(at3.relaxed.map((notice) => notice.message)).toEqual(['No encontramos lugares a menos de 1,5 km: te mostramos hasta 3 km.'])

    const onlyFar = fakeStore(far.filter((place) => place.id !== 'cafe-famoso'))
    const at5 = await runSearch('', { store: onlyFar.store, cache: fakeCache().cache }, { now, filters: 'category:cafe', near: '-34.9,-56.18' })
    expect(onlyFar.calls.map((call) => call.filters.near?.radiusM)).toEqual([1500, 3000, 5000])
    expect(at5.relaxed.map((notice) => notice.message)).toEqual(['No encontramos lugares a menos de 1,5 km: te mostramos hasta 5 km.'])
  })

  it('"café cerca mío" sin ubicación pide la ubicación y busca igual', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('café cerca mío', { store, cache: fakeCache().cache }, { now })
    expect(response.needsLocation).toBe(true)
    expect(response.near).toBeNull()
    expect(response.results.length).toBeGreaterThan(0)
  })
})
