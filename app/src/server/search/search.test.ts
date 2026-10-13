import { describe, expect, it } from 'vitest'
import { SEARCH_CONFIG } from './config'
import { dishTarget } from './dishes'
import { buildRankings, fuse, reciprocalRankFusion, type FuseContext } from './fuse'
import { runSearch } from './search'
import { everyDay, fakeCache, fakeStore, llmOutput, row } from './test/fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], openAt: null, ...overrides,
})

describe('fusión', () => {
  it('RRF con k = 60 suma 1 / (k + puesto) por ranking', () => {
    const scores = reciprocalRankFusion({
      semantic: [{ id: 'a', name: 'a', score: 0.9 }, { id: 'b', name: 'b', score: 0.8 }],
      keyword: [{ id: 'b', name: 'b', score: 0.5 }],
      name: [],
      distance: [],
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
      { kind: 'category', id: 'cafe', label: 'Café' },
      { kind: 'neighborhood', id: 'CORDON', label: 'Cordón' },
    ])
    expect(response.results[0].reasons).toEqual(['Café', 'Abierto · cierra 20:00', 'Cordón'])
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

  it('si el modelo falla sigue con la consulta como nombre y embedding', async () => {
    const { store } = fakeStore(places)
    const { cache } = fakeCache(new Error('timeout'))
    const response = await runSearch('lugar raro', { store, cache }, { now, debug: true })
    expect(response.debug?.source).toBe('fallback')
    expect(response.debug?.llmError).toBe('timeout')
    expect(response.results).toHaveLength(places.length)
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
      { kind: 'diet', id: 'vegan', label: 'Vegano' },
      { kind: 'diet', id: 'glutenFree', label: 'Sin TACC' },
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
