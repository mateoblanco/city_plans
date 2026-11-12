import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_CONFIG } from '../config'
import { dishTarget } from '../dishes'
import { boostsFor, buildRankings, fuse, qualityMultiplier, reciprocalRankFusion, type FuseContext } from '../fuse'
import { buildChips } from '../chips'
import { emptyInterpretation } from '../interpretation'
import { noMatchNotice } from '../relax'
import { memoryCache } from '../cache'
import { keywordsFor, nameWordsFor, runSearch } from '../search'
import { interpretWithDictionary } from '../dictionary'
import { normalizeQuery } from '../normalize'
import { everyDay, fakeCache, fakeStore, llmOutput, row } from './fixtures'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')
const context = (overrides: Partial<FuseContext> = {}): FuseContext => ({
  pinnedId: null, dishes: [], categories: [], requestedTags: [], preferTags: [], moments: [], cuisines: [], preferStyle: null, price: [], openAt: null, wantsBest: false, intent: null, section: null, diet: [], preferDiet: [], ...overrides,
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
    const fused = fuse(rows, buildRankings(rows), context({ pinnedId: 'pinned', openAt: { moment: { day: 1, time: '13:00' }, today: false, night: false } }))
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
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const places = [
    row({ id: 'cafe-cordon', name: 'Café del Cordón', categories: ['cafe'], tags: ['terrace'], iconCategory: 'coffee', logoKey: 'cafe-cordon.png', logoBgColor: '#f4e1c1', locatedIn: 'Mercado Ferrando', hours: everyDay('08:00', '20:00'), diet: { vegan: 'has_options', vegetarian: 'unknown', glutenFree: 'unknown' } }),
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
    // "Cafés" elige la intención: la categoría deja de ser un filtro suelto y sigue ordenando como preferencia.
    expect(response.bar.intent).toEqual({ id: 'cafes', fromText: true })
    expect(response.bar.extras).toEqual([])
    expect(response.interpreted.chips).toEqual([
      { kind: 'neighborhood', id: 'CORDON', label: 'Cordón', fromText: true, fromFilter: false },
      { kind: 'prefer', id: 'cafe', label: 'Café', fromText: false, fromFilter: false },
    ])
    // El horario, el barrio y la categoría ya están en la card: no son motivos.
    expect(response.results[0].reasons).toEqual([])
    expect(response.results[0].iconCategory).toBe('coffee')
    expect(response.results[0]).toMatchObject({ logoKey: 'cafe-cordon.png', logoBgColor: '#f4e1c1', locatedIn: 'Mercado Ferrando' })
  })

  it('arma logoUrl en el servidor desde LOGO_BASE_URL; sin clave queda en null', async () => {
    vi.stubEnv('LOGO_BASE_URL', 'https://pub-x.r2.dev')
    const { store } = fakeStore(places)
    const response = await runSearch('Cafés', { store, cache: fakeCache().cache }, { now })
    const byId = new Map(response.results.map((result) => [result.id, result]))
    expect(byId.get('cafe-cordon')).toMatchObject({ logoUrl: 'https://pub-x.r2.dev/cafe-cordon.png', logoBgColor: '#f4e1c1' })
    expect(byId.get('cafe-rodo')?.logoUrl).toBeNull()
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
    expect(response.bar.intent).toEqual({ id: 'cafes', fromText: true })
    const rodo = response.debug?.results.find((result) => result.id === 'cafe-rodo')
    expect(rodo).toMatchObject({ featured: true, prominence: 0 })
    expect(rodo?.multiplier).toBeCloseTo(SEARCH_CONFIG.quality.best.prominenceMin * SEARCH_CONFIG.quality.best.featured)
    expect(response.results.find((result) => result.id === 'cafe-rodo')?.reasons[0]).toBe('Recomendado')
    expect(response.results.find((result) => result.id === 'cafe-cordon')?.reasons).not.toContain('Recomendado')
  })

  it('"best" en inglés: "Recomendado" (lo que se muestra, siempre en español)', async () => {
    // En Pocitos no hay cafés: el de Parque Rodó sale en "Cerca de Pocitos".
    const withFeatured = places.map((place) => (place.id === 'cafe-rodo' ? { ...place, featured: true, edgeDistance: 250 } : place))
    const { store } = fakeStore(withFeatured)
    const response = await runSearch('best cafe in pocitos', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.source).toBe('shortcut')
    expect(response.debug?.interpretation.wantsBest).toBe(true)
    expect(response.nearby?.results.find((result) => result.id === 'cafe-rodo')?.reasons[0]).toBe('Recomendado')
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
    expect(response.debug?.discarded).toEqual([{ value: 'no_existe', reason: 'no está en los catálogos' }])
    expect(response.results.map((result) => result.id)).not.toContain('pizzeria')
    // Las palabras de lo excluido no se buscan por keyword.
    expect(response.debug?.keywords).not.toContain('pizza')
  })

  it('si el modelo falla sigue sin avisar: el texto tal cual para palabras y embedding, sin las vacías para el nombre', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, embedded } = fakeCache(new Error('timeout'))
    const response = await runSearch('lugar raro', { store, cache }, { now, debug: true })
    expect(response.debug?.source).toBe('fallback')
    expect(response.debug?.llmError).toBe('timeout')
    expect(response.results).toHaveLength(places.length)
    expect(response.relaxed).toEqual([])
    expect(response.interpreted.chips).toEqual([])
    expect(embedded).toEqual(['lugar raro'])
    expect(calls[0].scores).toMatchObject({ name: 'raro', keywords: ['raro'] })
  })

  it('si el modelo falla, toma del diccionario lo que reconoce e ignora lo negado', async () => {
    const { store } = fakeStore(places)
    const { cache } = fakeCache(new Error('timeout'))
    const response = await runSearch('cafecito rico en cordon que no sea pizza', { store, cache }, { now, debug: true })
    expect(response.debug?.source).toBe('fallback')
    expect(response.interpreted.chips.map((chip) => `${chip.kind}:${chip.id}`)).toEqual(['neighborhood:CORDON'])
    expect(response.results.map((result) => result.id)).not.toContain('cafe-rodo')
  })

  it('un nombre fuerte va primero: el modelo corrió en paralelo pero se descarta (y su costo cuenta)', async () => {
    const { store } = fakeStore(places, [{ id: 'bodegon', name: 'Bodegón', similarity: 0.9, wordSimilarity: 1 }])
    const { cache, interpreted } = fakeCache(llmOutput({ must: { ...llmOutput().must, categories: ['pizzeria'] } }), { cost: 0.001 })
    const response = await runSearch('el mingus', { store, cache }, { now, debug: true })
    expect(interpreted).toEqual(['el mingus'])
    expect(response.debug?.source).toBe('name')
    expect(response.results[0].id).toBe('bodegon')
    expect(response.interpreted.chips.map((chip) => chip.kind)).toEqual(['name'])
    expect(response.debug?.cost.calls.find((call) => call.step === 'interpret')).toMatchObject({ usd: 0.001, discarded: true })
  })

  it('el nombre, el modelo y el embedding de la consulta arrancan juntos', async () => {
    const started: string[] = []
    let releaseNames: () => void = () => {}
    const namesGate = new Promise<void>((resolve) => (releaseNames = resolve))
    const base = fakeStore(places)
    const store = {
      ...base.store,
      async nameMatches() {
        started.push('names')
        await namesGate
        return []
      },
    }
    const { cache: inner } = fakeCache()
    const cache = {
      async interpret(normalized: string) {
        started.push('interpret')
        // La búsqueda por nombre sigue esperando: sólo se libera cuando el modelo ya arrancó.
        releaseNames()
        return inner.interpret(normalized)
      },
      async embed(text: string) {
        started.push(`embed:${text}`)
        return inner.embed(text)
      },
    }
    const response = await runSearch('algo rico para hoy', { store, cache }, { now, debug: true })
    expect(response.debug?.source).toBe('llm')
    expect(started.slice(0, 3).sort()).toEqual(['embed:algo rico para hoy', 'interpret', 'names'])
    expect(response.debug?.timings).toHaveProperty('parallel')
  })

  it('el vibe distinto del texto se embebe aparte; sin vibe, un solo embedding', async () => {
    const { store } = fakeStore(places)
    const withVibe = fakeCache(llmOutput({ vibe: 'lugar tranquilo para leer' }))
    await runSearch('algo tranqui pa leer', { store, cache: withVibe.cache }, { now })
    expect(withVibe.embedded).toEqual(['algo tranqui pa leer', 'lugar tranquilo para leer'])
    const plain = fakeCache(llmOutput())
    await runSearch('algo rico para hoy', { store, cache: plain.cache }, { now })
    expect(plain.embedded).toEqual(['algo rico para hoy'])
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

  it('relaja en orden: tags de must a prefer (mirando sólo el barrio) y openAt (si tampoco hay nada cerca); el barrio nunca', async () => {
    // Con horario confirmado los dos cafés están cerrados a las 23, así que hace falta relajar openAt. Café Rodó está a
    // 300 m de Pocitos; Café del Cordón, lejos.
    const confirmed = places.map((place) => (place.id === 'cafe-rodo' ? { ...place, hours: everyDay('08:00', '18:00'), edgeDistance: 300 } : place))
    const { store, calls, nearbyCalls } = fakeStore(confirmed)
    const { cache } = fakeCache(
      llmOutput({ must: { categories: ['cafe'], tags: ['live_music'], diet: { vegan: false, vegetarian: false, glutenFree: false }, neighborhoods: ['Pocitos'], price: [], openAt: { today: false, tonight: false, day: 1, time: '23:00' } } }),
    )
    const response = await runSearch('cafe con musica en pocitos a las 23', { store, cache }, { now })
    const shape = (call: (typeof calls)[number]) => [call.filters.tags.length, call.filters.neighborhoods.length, call.filters.openAt !== null]
    expect(calls.map(shape)).toEqual([
      [1, 1, true],
      [0, 1, true],
      [0, 1, false],
    ])
    // Cada intento consulta también los cercanos, con los mismos filtros y sin el barrio.
    expect(nearbyCalls.map(shape)).toEqual([
      [1, 0, true],
      [0, 0, true],
      [0, 0, false],
    ])
    expect(nearbyCalls.every((call) => call.filters.nearby?.exclude.includes('POCITOS') && call.filters.nearby.radiusM === 500)).toBe(true)
    // Ya hay algo cerca: no se llega al último recurso y las categorías siguen.
    expect(calls[2].filters.categories).toEqual(['cafe'])
    // Que la música en vivo pase a ser preferencia no se avisa; el barrio vacío y el horario sí, en lenguaje de usuario.
    expect(response.relaxed).toEqual([
      { what: 'neighborhood', message: 'No encontramos en Pocitos; estos están cerca.' },
      { what: 'openAt', message: 'No hay nada abierto el lunes a las 23:00; te mostramos también los cerrados.' },
    ])
    expect(response.results).toEqual([])
    expect(response.nearby).toMatchObject({ title: 'Cerca de Pocitos', label: 'Pocitos', total: 1 })
    expect(response.nearby?.results.map((result) => result.id)).toEqual(['cafe-rodo'])
  })

  it('con los tags relajados se queda en el barrio pedido', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('cafe con terraza y musica en vivo en parque rodo', { store, cache: fakeCache().cache }, { now })
    expect(calls).toHaveLength(2)
    expect(calls[1].filters.neighborhoods).toEqual(['PARQUE RODO'])
    expect(response.results.map((result) => result.id)).toEqual(['cafe-rodo'])
  })

  it('los avisos de una consulta en inglés, en español: plato con relacionados y barrio', async () => {
    const withPeruvian = [...places, row({ id: 'peruano', categories: ['restaurant'], tags: ['peruvian'] })]
    const { store } = fakeStore(withPeruvian)
    const { cache } = fakeCache(llmOutput({ language: 'en', dishes: [{ name: 'ceviche', related: ['peruvian'] }] }))
    const response = await runSearch('ceviche please', { store, cache }, { now })
    expect(response.relaxed.map((step) => step.message)).toEqual(['No hay ceviche, pero estos tienen cocina peruana.'])
    const rodoNearPocitos = places.map((place) => (place.id === 'cafe-rodo' ? { ...place, edgeDistance: 250 } : place))
    const nearby = await runSearch('cafe in pocitos', { store: fakeStore(rodoNearPocitos).store, cache: fakeCache().cache }, { now })
    expect(nearby.relaxed.map((step) => step.message)).toEqual(['No encontramos en Pocitos; estos están cerca.'])
  })

  it('un tag que pasa a preferencia no genera aviso', async () => {
    const withBoth = [...places, row({ id: 'cafe-terraza', categories: ['cafe'], tags: ['terrace'], neighborhoodId: 'POCITOS' })]
    // Nadie tiene terraza y música; el único con terraza está en Pocitos: sólo se avisa de la música.
    const { store } = fakeStore(withBoth)
    const response = await runSearch('cafe con terraza y musica en vivo en pocitos', { store, cache: fakeCache().cache }, { now })
    expect(response.results.map((result) => result.id)).toEqual(['cafe-terraza'])
    expect(response.relaxed).toEqual([])
  })

  it('un plato que nadie tiene se busca por sus tags relacionados, con aviso', async () => {
    const withPeruvian = [...places, row({ id: 'peruano', categories: ['restaurant'], tags: ['peruvian'] })]
    const { store, calls } = fakeStore(withPeruvian)
    const { cache } = fakeCache(llmOutput({ dishes: [{ name: 'ceviche', related: ['peruvian', 'seafood', 'inventado'] }] }))
    // "fresco" no está en el diccionario: la consulta pasa por el modelo.
    const response = await runSearch('ceviche fresco', { store, cache }, { now, debug: true })
    expect(response.debug?.discarded).toEqual([{ value: 'inventado', reason: 'no está en los catálogos' }])
    expect(calls.map((call) => call.filters.dishMode)).toEqual(['dish', 'related'])
    expect(response.results.map((result) => [result.id, result.matchLevel])).toEqual([['peruano', 'maybe']])
    expect(response.results[0].reasons[0]).toBe('Cocina peruana')
    expect(response.relaxed).toEqual([{ what: 'dishRelated', message: 'No hay ceviche, pero estos tienen cocina peruana.' }])
  })

  it('un plato típico de una cocina lo resuelve el diccionario como plato, con la cocina de respaldo', async () => {
    const withPeruvian = [...places, row({ id: 'peruano', categories: ['restaurant'], tags: ['peruvian'] })]
    const { store, calls } = fakeStore(withPeruvian)
    const { cache } = fakeCache()
    const response = await runSearch('ceviche', { store, cache }, { now })
    expect(calls.map((call) => call.filters.dishMode)).toEqual(['dish', 'related'])
    expect(calls[0].filters.tags).not.toContain('peruvian')
    expect(response.results.map((result) => [result.id, result.matchLevel])).toEqual([['peruano', 'maybe']])
    expect(response.relaxed).toEqual([{ what: 'dishRelated', message: 'No hay ceviche, pero estos tienen cocina peruana.' }])
  })

  it('sin plato ni tags relacionados muestra resultados por similitud', async () => {
    const { store, calls } = fakeStore(places)
    const { cache } = fakeCache(llmOutput({ dishes: [{ name: 'ceviche', related: ['peruvian'] }], must: { categories: ['restaurant'], tags: [], diet: { vegan: false, vegetarian: false, glutenFree: false }, neighborhoods: [], price: [], openAt: null } }))
    const response = await runSearch('ceviche', { store, cache }, { now })
    expect(calls.map((call) => call.filters.dishMode)).toEqual(['dish', 'related', 'none'])
    expect(calls[2].filters.categories).toEqual([])
    // La intención (Comer, por el plato) no se relaja: quedan sólo los restaurantes.
    expect(calls[2].filters.groups).toHaveLength(1)
    expect(response.results.map((result) => result.id).sort()).toEqual(['bodegon', 'pizzeria'])
    expect(response.relaxed.map((step) => step.what)).toEqual(['dishRelated', 'similarity'])
    expect(response.relaxed.map((step) => step.message)).toEqual([
      'No hay ceviche; estos son los más parecidos.',
      'No encontramos exactamente lo que buscás; estos son los más parecidos.',
    ])
    expect(response.suggestedRemovals).toEqual([])
  })

  it('nunca relaja la dieta ni los exclude; con cero dice qué bloquea y qué filtro sacar', async () => {
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
    expect(response.relaxed).toEqual([
      { what: 'noMatch', message: 'No encontramos lugares con opciones veganas y sin TACC confirmadas. Probá sacar Vegano o Sin TACC de los filtros.' },
    ])
    expect(response.suggestedRemovals).toEqual([
      { kind: 'diet', id: 'vegan', label: 'Vegano', fromText: true, fromFilter: false },
      { kind: 'diet', id: 'glutenFree', label: 'Sin TACC', fromText: true, fromFilter: false },
    ])
  })

  it('hay resultados siempre que existan publicados que cumplan dieta y exclude, en el barrio o cerca', async () => {
    // Café del Cordón está a 400 m de Pocitos: el último recurso conserva el barrio y sus cercanos.
    const { store } = fakeStore(places.map((place) => (place.id === 'cafe-cordon' ? { ...place, edgeDistance: 400 } : place)))
    const { cache } = fakeCache(
      llmOutput({
        must: { categories: ['bar'], tags: ['karaoke'], diet: { vegan: true, vegetarian: false, glutenFree: false }, neighborhoods: ['Pocitos'], price: ['high'], openAt: { today: true, tonight: false, day: null, time: null } },
        dishes: [{ name: 'ceviche', related: [] }],
      }),
    )
    const response = await runSearch('bar vegano con karaoke y ceviche en pocitos abierto ahora', { store, cache }, { now })
    expect(response.results).toEqual([])
    expect(response.nearby?.results.map((result) => result.id)).toEqual(['cafe-cordon'])
    expect(response.relaxed.at(0)?.what).toBe('neighborhood')
    expect(response.relaxed.at(-1)?.what).toBe('similarity')
  })

  it('remove saca chips sin volver a interpretar distinto', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, embedded } = fakeCache()
    const response = await runSearch('cafes con terraza en cordon', { store, cache }, { now, remove: 'tag:terrace,neighborhood:CORDON' })
    expect(response.interpreted.chips.map((chip) => chip.kind)).toEqual(['prefer'])
    expect(response.bar.intent?.id).toBe('cafes')
    expect(calls[0].filters.tags).toEqual([])
    expect(calls[0].filters.neighborhoods).toEqual([])
    // Atajo: el embedding usa la consulta sin las palabras de lo quitado.
    expect(embedded).toEqual(['cafes'])
    expect(calls[0].scores.keywords).toEqual(['cafes'])
    expect(response.results.map((result) => result.id).sort()).toEqual(['cafe-cordon', 'cafe-rodo'])
  })

  it('atajo con un plato quitado: la consulta sin el plato para embedding y keywords', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, embedded } = fakeCache()
    const response = await runSearch('pizza en cordon', { store, cache }, { now, remove: 'dish:pizza', debug: true })
    expect(response.debug!.source).toBe('shortcut')
    expect(embedded).toEqual(['cordon'])
    expect(calls[0].scores.keywords).toEqual(['cordon'])
  })

  it('corte por relevancia: debug muestra la similitud y por qué se cortó', async () => {
    const quiet = fakeCache(llmOutput({ vibe: 'lugar tranquilo para charlar', prefer: { categories: [], tags: ['quiet'] } })).cache
    const rows = [
      row({ id: 'parecido', semantic: 0.45 }),
      row({ id: 'lejos', semantic: 0.3 }),
      row({ id: 'lejos-tranquilo', semantic: 0.3, tags: ['quiet'] }),
      row({ id: 'lejos-con-palabra', semantic: 0.2, keyword: 0.1 }),
    ]
    const response = await runSearch('algo tranqui para charlar', { store: fakeStore(rows).store, cache: quiet }, { now, debug: true })
    expect(response.results.map((result) => result.id).sort()).toEqual(['lejos-con-palabra', 'lejos-tranquilo', 'parecido'])
    expect(response.debug!.relevance).toEqual({ best: 0.45, threshold: 0.37, gap: 0.08 })
    const cut = response.debug!.results.at(-1)!
    expect(cut).toMatchObject({ id: 'lejos', similarity: 0.3 })
    expect(cut.relevance).toEqual({ cut: true, reason: 'similitud 0,300 < 0,370 (mejor 0,450 − 0,08), sin coincidencia explícita' })
    expect(response.debug!.results.find((result) => result.id === 'lejos-tranquilo')!.relevance).toEqual({ kept: 'tag' })
  })

  it('"near me" pide ubicación y responde en español', async () => {
    const { store } = fakeStore(places)
    expect((await runSearch('vegan near me', { store, cache: fakeCache().cache }, { now })).location).toEqual({ kind: 'ask', explicit: true })
    const response = await runSearch('vegan near me', { store, cache: fakeCache().cache }, { now, loc: 'all' })
    expect(response.results[0].reasons).toEqual(['Opciones veganas'])
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

  it('consulta que queda vacía al normalizar: búsqueda genérica, sin modelo ni embedding', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, interpreted, embedded } = fakeCache()
    const response = await runSearch('  ¿? ', { store, cache }, { now, debug: true })
    expect(interpreted).toEqual([])
    expect(embedded).toEqual([])
    expect(calls).toHaveLength(1)
    expect(response.debug?.source).toBe('filters')
    expect(response.results.length).toBeGreaterThan(0)
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
    // El idioma detectado sólo interpreta: lo que se muestra sale siempre en español.
    expect(buildChips({ ...value, language: 'en' }, 1).find((chip) => chip.kind === 'exclude')?.label).toBe('Excepto restaurantes')
  })

  it('el aviso de cero resultados nombra lo excluido y sugiere sacar la dieta de la barra', () => {
    expect(noMatchNotice(value, { diet: true, exclude: true }).message).toBe(
      'No encontramos lugares con opciones veganas confirmadas que no sean restaurantes, bares ni pizza. Probá sacar Vegano de los filtros.',
    )
    expect(noMatchNotice(value, { diet: false, exclude: true }).message).toBe('No encontramos lugares que no sean restaurantes, bares ni pizza.')
    expect(noMatchNotice(value, { diet: true, exclude: false }).message).toBe('No encontramos lugares con opciones veganas confirmadas. Probá sacar Vegano de los filtros.')
    expect(noMatchNotice({ ...value, language: 'en' }, { diet: true, exclude: false }).message).toBe(
      'No encontramos lugares con opciones veganas confirmadas. Probá sacar Vegano de los filtros.',
    )
  })
})

describe('brunch con pocos resultados', () => {
  const cafe = (id: string, tags: string[]) => row({ id, categories: ['cafe'], tags })
  const places = [
    cafe('b1', ['brunch']),
    cafe('b2', ['brunch', 'breakfast', 'lunch']),
    cafe('dl1', ['breakfast', 'lunch']),
    cafe('dl2', ['breakfast', 'lunch', 'terrace']),
    cafe('d', ['breakfast']),
    row({ id: 'resto', categories: ['restaurant'], tags: ['breakfast', 'lunch'] }),
  ]

  it('completa debajo, como maybe, con cafés de desayuno y almuerzo sin el tag', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('brunch', { store, cache: fakeCache().cache }, { now, debug: true })
    const byId = new Map(response.results.map((result) => [result.id, result]))
    expect(response.results.map((result) => result.id).slice(0, 2).sort()).toEqual(['b1', 'b2'])
    expect(response.results.map((result) => result.id).slice(2).sort()).toEqual(['dl1', 'dl2'])
    expect(response.results.slice(0, 2).every((result) => result.matchLevel === 'has')).toBe(true)
    for (const id of ['dl1', 'dl2']) {
      expect(byId.get(id)).toMatchObject({ matchLevel: 'maybe' })
      expect(byId.get(id)!.reasons).toContain('Desayuno y almuerzo')
      expect(byId.get(id)!.reasons).not.toContain('Brunch')
    }
    expect(response.debug?.brunchFill).toEqual({ has: 2, added: 2 })
  })

  it('igual con el sub-filtro de la barra que con el texto', async () => {
    const levels = (response: Awaited<ReturnType<typeof runSearch>>) =>
      Object.fromEntries(['has', 'maybe'].map((level) => [level, response.results.filter((result) => result.matchLevel === level).map((result) => result.id).sort()]))
    const fromText = await runSearch('brunch', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true })
    const fromSub = await runSearch('', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true, intent: 'cafes', sub: 'brunch' })
    const absorbed = await runSearch('brunch', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, debug: true, intent: 'cafes' })
    expect(levels(fromText)).toEqual({ has: ['b1', 'b2'], maybe: ['dl1', 'dl2'] })
    expect(levels(fromSub)).toEqual(levels(fromText))
    expect(levels(absorbed)).toEqual(levels(fromText))
    for (const response of [fromSub, absorbed]) {
      expect(response.debug?.brunchFill).toEqual({ has: 2, added: 2 })
      expect(response.results.find((result) => result.id === 'dl1')!.reasons).toContain('Desayuno y almuerzo')
    }
  })

  it('no repite una marca que ya salió arriba', async () => {
    const { store } = fakeStore([
      row({ id: 'm1', categories: ['cafe'], tags: ['brunch'], brandKey: 'marca' }),
      row({ id: 'm2', categories: ['cafe'], tags: ['breakfast', 'lunch'], brandKey: 'marca' }),
      cafe('dl', ['breakfast', 'lunch']),
    ])
    const response = await runSearch('brunch', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.results.map((result) => result.id)).toEqual(['m1', 'dl'])
  })

  it('con 12 o más "has" no completa', async () => {
    const many = Array.from({ length: 12 }, (_, index) => cafe(`b${index}`, ['brunch']))
    const { store } = fakeStore([...many, cafe('dl', ['breakfast', 'lunch'])])
    const response = await runSearch('brunch', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.results.map((result) => result.id)).not.toContain('dl')
    expect(response.debug?.brunchFill).toBeNull()
  })
})

describe('idioma', () => {
  it('una consulta en inglés se muestra en español', async () => {
    const { store } = fakeStore([row({ id: 'gf', categories: ['cafe'], diet: { ...row({ id: 'x' }).diet, glutenFree: 'fully' } })])
    const response = await runSearch('gluten free', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.debug?.interpretation.language).toBe('en')
    expect(response.results[0].reasons).toContain('Todo sin TACC')
    expect(response.results[0].openStatus.label).not.toMatch(/Open|Closed/)
  })
})

describe('mensaje de vacío', () => {
  const places = [row({ id: 'tinkal', name: 'Bar Tinkal', categories: ['bar'] }), row({ id: 'otro', categories: ['restaurant'] })]
  const noCandidates = (rows: typeof places) => {
    const { store } = fakeStore(rows)
    return { ...store, candidates: async () => [] }
  }

  it('con una coincidencia de nombre, ningún mensaje de vacío', async () => {
    const { store } = fakeStore(places, [{ id: 'tinkal', name: 'Bar Tinkal', similarity: 0.6, wordSimilarity: 1 }])
    const response = await runSearch('Tinkal', { store, cache: fakeCache().cache }, { now, debug: true })
    expect(response.results.map((result) => result.id)).toContain('tinkal')
    expect(response.relaxed.filter((notice) => notice.what === 'noMatch')).toEqual([])
    expect(response.sections).toBeNull()
    expect(response.debug?.sections.notGrouped).toBe('nombre')
  })

  it('sin resultados y con lugares publicados: que no se encontró la consulta', async () => {
    const response = await runSearch('xqzw', { store: noCandidates(places), cache: fakeCache().cache }, { now })
    expect(response.relaxed).toEqual([{ what: 'noMatch', message: 'No encontramos lugares para “xqzw”. Probá con otras palabras o sacá algún filtro.' }])
  })

  it('sin texto, sólo con filtros', async () => {
    const response = await runSearch('', { store: noCandidates(places), cache: fakeCache().cache }, { now, filters: 'open:today' })
    expect(response.relaxed).toEqual([{ what: 'noMatch', message: 'No encontramos lugares con estos filtros. Probá sacar alguno.' }])
  })

  it('"Todavía no hay lugares publicados" sólo con la base vacía', async () => {
    const response = await runSearch('xqzw', { store: fakeStore([]).store, cache: fakeCache().cache }, { now })
    expect(response.relaxed).toEqual([{ what: 'noMatch', message: 'Todavía no hay lugares publicados.' }])
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
    expect(response.interpreted.chips.filter((chip) => chip.kind === 'neighborhood').map((chip) => chip.id)).toEqual(['CORDON'])
    expect(ids(response)).not.toContain('cafe-pocitos')
  })

  it('un chip que está en el texto y en la barra viene de los dos', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('cafés en Cordón', { store, cache: fakeCache().cache }, { now, filters: 'neighborhood:CORDON' })
    expect(response.interpreted.chips[0]).toEqual({ kind: 'neighborhood', id: 'CORDON', label: 'Cordón', fromText: true, fromFilter: true })
  })

  it('sólo con filtros: sin modelo ni embedding, por calidad y con los de horario sin confirmar abajo', async () => {
    const { store, calls } = fakeStore(places)
    const { cache, interpreted, embedded } = fakeCache()
    const response = await runSearch('', { store, cache }, { now, filters: 'open:today', intent: 'cafes', debug: true })
    expect(interpreted).toEqual([])
    expect(embedded).toEqual([])
    expect(response.debug?.source).toBe('filters')
    expect(calls[0].scores).toMatchObject({ embedding: null, keywords: [], name: null })
    expect(ids(response)).toEqual(['cafe-famoso', 'cafe-cordon', 'cafe-pocitos', 'cafe-sin-horario'])
    expect(response.interpreted.chips.map((chip) => [chip.kind, chip.fromFilter])).toEqual([['openAt', true]])
    expect(response.bar.intent).toEqual({ id: 'cafes', fromText: false })
  })

  it('abre hoy: abiertos y los que abren más tarde por relevancia, sin horario al final; afuera los que ya cerraron o no abren hoy', async () => {
    // Lunes 13:00.
    const { store } = fakeStore([
      row({ id: 'abierto', hours: everyDay('12:00', '16:00'), prominence: 0.2 }),
      row({ id: 'abre-mas-tarde', hours: everyDay('20:00', '23:30'), prominence: 0.8 }),
      row({ id: 'ya-cerro', hours: everyDay('07:00', '11:00'), prominence: 0.9 }),
      row({ id: 'cerrado-hoy', hours: { status: 'exact', slots: [{ day: 2, opens: '12:00', closes: '16:00' }] }, prominence: 0.9 }),
      row({ id: 'sin-horario', prominence: 1, featured: true }),
    ])
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, filters: 'open:today', debug: true })
    expect(ids(response)).toEqual(['abre-mas-tarde', 'abierto', 'sin-horario'])
    expect(response.results.map((result) => result.openStatus.label)).toEqual(['Cerrado · Abre 20:00', 'Abierto · cierra 16:00', 'Horario sin confirmar'])
    expect(response.debug?.results.every((result) => result.boosts.confirmedOpen === undefined)).toBe(true)
    expect(response.interpreted.chips).toEqual([{ kind: 'openAt', id: 'today', label: 'Abre hoy', fromText: false, fromFilter: true }])
  })

  it('cenar hoy es a la noche: afuera el que sólo abre al mediodía aunque esté abierto ahora', async () => {
    // Lunes 13:00.
    const { store } = fakeStore([
      row({ id: 'mediodia', hours: everyDay('12:00', '15:00') }),
      row({ id: 'todo-el-dia', hours: everyDay('12:00', '01:00') }),
      row({ id: 'noche', hours: everyDay('20:00', '00:00') }),
    ])
    const response = await runSearch('cenar hoy', { store, cache: fakeCache().cache }, { now })
    expect(ids(response).sort()).toEqual(['noche', 'todo-el-dia'])
    expect(response.interpreted.chips.find((chip) => chip.kind === 'openAt')).toMatchObject({ id: 'today', label: 'Abre hoy' })
  })

  it('sin tope de resultados: se muestran todos, con los de horario sin confirmar al final', async () => {
    const { store } = fakeStore([
      ...Array.from({ length: 25 }, (_, index) => row({ id: `abierto-${index}`, hours: everyDay('08:00', '23:00'), prominence: 0.5 })),
      row({ id: 'sin-horario', prominence: 1, featured: true }),
    ])
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, filters: 'open:today' })
    expect(ids(response)).toHaveLength(26)
    expect(ids(response).at(-1)).toBe('sin-horario')
  })

  it('sin texto ni filtros (/search vacío): todos los publicados, por calidad, sin modelo ni embedding', async () => {
    // Un filtro inválido se descarta: queda una búsqueda vacía igual.
    for (const filters of [undefined, 'tag:inventado']) {
      const { store, calls } = fakeStore(places)
      const { cache, interpreted, embedded } = fakeCache()
      const response = await runSearch('', { store, cache }, { now, filters, debug: true })
      expect(interpreted).toEqual([])
      expect(embedded).toEqual([])
      expect(calls).toHaveLength(1)
      expect(calls[0].scores).toMatchObject({ embedding: null, keywords: [], name: null })
      expect(response.debug?.source).toBe('filters')
      expect(response.interpreted.chips).toEqual([])
      expect(response.relaxed).toEqual([])
      expect(ids(response)).toEqual(['cafe-sin-horario', 'cafe-famoso', 'cafe-cordon', 'cafe-pocitos', 'pizzeria-pocitos', 'pizzeria-cordon'])
    }
  })

  // Cordón: dentro de Montevideo. La URL nunca lleva la coordenada: viene de la cookie `loc`.
  const CORDON = '-34.905,-56.185'
  const cafes = (count: number, distance: number, prefix: string) =>
    Array.from({ length: count }, (_, index) => row({ id: `${prefix}-${index}`, categories: ['cafe'], distance: distance + index * 10 }))

  it('cerca mío por defecto con la cookie: radio de 1,5 km si alcanza, la distancia en la card y el chip', async () => {
    const { store, calls } = fakeStore([...cafes(8, 300, 'cerca'), ...cafes(3, 2500, 'lejos')])
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', userLocation: CORDON, defaultNear: true, debug: true })
    expect(response.location).toEqual({ kind: 'near', origin: { lat: -34.905, lng: -56.185 }, radiusM: 1500 })
    expect(response.near).toEqual({ lat: -34.905, lng: -56.185 })
    // Los tres radios en paralelo; se usa el primero con suficientes.
    expect(calls.map((call) => call.filters.near?.radiusM)).toEqual([1500, 3000, 5000])
    expect(calls[0].scores.origins).toEqual([{ lat: -34.905, lng: -56.185 }])
    expect(response.debug?.near).toEqual({ tried: [{ radiusM: 1500, has: 8 }, { radiusM: 3000, has: 11 }, { radiusM: 5000, has: 11 }], chosen: 1500 })
    expect(response.results.map((result) => result.id).every((id) => id.startsWith('cerca-'))).toBe(true)
    expect(response.results.find((result) => result.id === 'cerca-0')?.distance).toBe('a 300 m')
    expect(response.interpreted.chips.at(-1)).toEqual({ kind: 'near', id: 'me', label: 'Cerca mío', fromText: false, fromFilter: false })
    expect(response.relaxed).toEqual([])
  })

  it('con pocos a 1,5 km agranda el radio al primero que alcanza y avisa', async () => {
    const { store } = fakeStore([...cafes(2, 400, 'cerca'), ...cafes(7, 2500, 'medio'), ...cafes(5, 4000, 'lejos')])
    const at3 = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: 'near', userLocation: CORDON })
    expect(at3.location).toMatchObject({ kind: 'near', radiusM: 3000 })
    expect(at3.results).toHaveLength(9)
    expect(at3.results.find((result) => result.id === 'medio-0')?.distance).toBe('a 2,5 km')
    expect(at3.relaxed.map((notice) => notice.message)).toEqual(['Había pocos a 1,5 km: ampliamos a 3 km.'])

    // Si ninguno llega, el más chico que ya da todo lo que hay (acá, recién el último).
    const few = fakeStore([...cafes(1, 400, 'cerca'), ...cafes(2, 4000, 'lejos')])
    const at5 = await runSearch('', { store: few.store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: 'near', userLocation: CORDON })
    expect(at5.location).toMatchObject({ kind: 'near', radiusM: 5000 })
    expect(at5.results).toHaveLength(3)
    expect(at5.relaxed.map((notice) => notice.message)).toEqual(['Había pocos a 1,5 km: ampliamos a 5 km.'])

    // 5 a 1,5 km y 6 a 3 y a 5 km: 3 km (ir a 5 no suma nada).
    const mid = fakeStore([...cafes(5, 400, 'cerca'), ...cafes(1, 2500, 'medio')])
    const at3Max = await runSearch('', { store: mid.store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: 'near', userLocation: CORDON })
    expect(at3Max.location).toMatchObject({ kind: 'near', radiusM: 3000 })
    // Todo lo que hay ya está a 1,5 km: no se agranda ni se avisa.
    const close = fakeStore(cafes(3, 400, 'cerca'))
    const at15 = await runSearch('', { store: close.store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: 'near', userLocation: CORDON })
    expect(at15.location).toMatchObject({ kind: 'near', radiusM: 1500 })
    expect(at15.relaxed).toEqual([])
  })

  it('con cerca mío lo más cercano sube: la distancia multiplica el puntaje', async () => {
    const { store } = fakeStore([
      row({ id: 'lejos', categories: ['cafe'], prominence: 0.6, distance: 1400 }),
      row({ id: 'cerca', categories: ['cafe'], prominence: 0.4, distance: 200 }),
    ])
    const near = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: 'near', userLocation: CORDON, debug: true })
    expect(near.results.map((result) => result.id)).toEqual(['cerca', 'lejos'])
    const [cerca, lejos] = near.debug!.results
    expect(cerca.multiplier / qualityMultiplier(cerca, false)).toBeCloseTo(0.94)
    expect(lejos.multiplier / qualityMultiplier(lejos, false)).toBeCloseTo(0.58)
  })

  it('sin cookie, la primera búsqueda pide la ubicación: sin resultados ni consultas de candidatos', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('cafés', { store, cache: fakeCache().cache }, { now, defaultNear: true })
    expect(response.location).toEqual({ kind: 'ask', explicit: false })
    expect(response.results).toEqual([])
    expect(response.near).toBeNull()
    expect(calls).toHaveLength(0)
    // La barra igual se arma con lo del texto.
    expect(response.bar.intent?.id).toBe('cafes')
  })

  it('con un barrio en el texto, el barrio: no hay cerca mío por defecto', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('cafés en cordón', { store, cache: fakeCache().cache }, { now, userLocation: CORDON, defaultNear: true })
    expect(response.location).toEqual({ kind: 'neighborhood' })
    expect(calls[0].filters.near).toBeNull()
    expect(response.near).toBeNull()
    expect(response.results.every((result) => result.distance === null)).toBe(true)
    // Sin cookie tampoco se pide: el barrio ya dice dónde.
    expect((await runSearch('cafés en cordón', { store, cache: fakeCache().cache }, { now, defaultNear: true })).location).toEqual({ kind: 'neighborhood' })
  })

  it('permiso negado: todo Montevideo, sin volver a pedir', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', userLocation: 'denied', defaultNear: true })
    expect(response.location).toEqual({ kind: 'all', reason: 'denied' })
    expect(calls[0].filters.near).toBeNull()
    expect(ids(response)).toHaveLength(4)
    // Elegir "Cerca mío" a mano (o escribirlo) sí lo pide de nuevo.
    expect((await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: 'near', userLocation: 'denied', defaultNear: true })).location).toEqual({ kind: 'ask', explicit: true })
  })

  it('"café cerca mío" sin ubicación la pide; con "Todo Montevideo" elegido, no', async () => {
    const { store } = fakeStore(places)
    const asked = await runSearch('café cerca mío', { store, cache: fakeCache().cache }, { now })
    expect(asked.location).toEqual({ kind: 'ask', explicit: true })
    expect(asked.results).toEqual([])
    const all = await runSearch('café cerca mío', { store, cache: fakeCache().cache }, { now, loc: 'all' })
    expect(all.location).toEqual({ kind: 'all', reason: 'chosen' })
    expect(all.results.length).toBeGreaterThan(0)
  })

  it('ubicación fuera de Montevideo: todo Montevideo con aviso', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', userLocation: '-34.603,-58.381', defaultNear: true })
    expect(response.location).toEqual({ kind: 'all', reason: 'outside' })
    expect(calls[0].filters.near).toBeNull()
    expect(response.relaxed.map((notice) => notice.message)).toEqual(['Tu ubicación está fuera de Montevideo: mostramos todo Montevideo.'])
  })

  it('un near=lat,lng viejo es cerca mío con la ubicación de quien abre el link', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', near: '-34.85,-56.25', userLocation: CORDON })
    expect(response.location).toMatchObject({ kind: 'near', origin: { lat: -34.905, lng: -56.185 } })
    expect(calls[0].scores.origins).toEqual([{ lat: -34.905, lng: -56.185 }])
  })

  it('"Buscar en esta zona" reemplaza el barrio del texto y busca sólo dentro del área', async () => {
    const inZone = { lat: -34.91, lng: -56.15 }
    const zonePlaces = [
      row({ id: 'tragos-zona', neighborhoodId: 'POCITOS', categories: ['bar'], ...inZone }),
      row({ id: 'tragos-zona-palermo', neighborhoodId: 'PALERMO', categories: ['bar'], ...inZone }),
      row({ id: 'tragos-palermo-afuera', neighborhoodId: 'PALERMO', categories: ['bar'], lat: -34.8, lng: -56.3 }),
    ]
    const { store, calls } = fakeStore(zonePlaces)
    const response = await runSearch('bares en palermo', { store, cache: fakeCache().cache }, {
      now,
      remove: 'neighborhood:PALERMO',
      loc: '-34.92,-56.16,-34.9,-56.14',
      userLocation: CORDON,
      defaultNear: true,
    })
    expect(response.location).toEqual({ kind: 'zone', bounds: { south: -34.92, west: -56.16, north: -34.9, east: -56.14 } })
    expect(calls[0].filters.neighborhoods).toEqual([])
    expect(calls[0].filters.zone).toEqual({ south: -34.92, west: -56.16, north: -34.9, east: -56.14 })
    expect(ids(response).sort()).toEqual(['tragos-zona', 'tragos-zona-palermo'])
    expect(response.near).toBeNull()
    // Un texto nuevo que nombra un barrio (sin remove) gana sobre la zona.
    const typed = await runSearch('bares en palermo', { store, cache: fakeCache().cache }, { now, loc: '-34.92,-56.16,-34.9,-56.14', defaultNear: true })
    expect(typed.location).toEqual({ kind: 'neighborhood' })
  })

  it('zona sin nada: lo dice', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: '-34.8,-56.3,-34.79,-56.29' })
    expect(response.results).toEqual([])
    expect(response.relaxed.map((notice) => notice.message)).toContain('No encontramos lugares en esta zona.')
  })
})

describe('sucursales de una marca', () => {
  const costa = (id: string, neighborhoodId: string, prominence: number, distance: number) =>
    row({ id, neighborhoodId, categories: ['cafe'], brandKey: 'costa-azul', brandCount: 4, prominence, distance, lat: -34.91, lng: -56.15 })
  const places = [
    costa('costa-pocitos', 'POCITOS', 0.9, 1400),
    costa('costa-cordon', 'CORDON', 0.5, 100),
    costa('costa-malvin', 'MALVIN', 0.1, 900),
    row({ id: 'cafe-medio', categories: ['cafe'], prominence: 0.7, distance: 500 }),
    row({ id: 'cafe-sin-marca', categories: ['cafe'], prominence: 0.3, distance: 600 }),
  ]
  const cards = (response: { results: { id: string; branchCount: number; branches: { id: string }[] }[] }) =>
    response.results.map((result) => [result.id, result.branchCount, result.branches.map((branch) => branch.id)])

  it('sin barrio ni ubicación: una card con la mejor rankeada, en su posición, y las demás en el mapa', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', debug: true })
    expect(cards(response)).toEqual([
      ['costa-pocitos', 4, ['costa-cordon', 'costa-malvin']],
      ['cafe-medio', 1, []],
      ['cafe-sin-marca', 1, []],
    ])
    expect(response.debug?.results.find((result) => result.id === 'costa-cordon')).toMatchObject({ brandKey: 'costa-azul', collapsedInto: 'costa-pocitos' })
  })

  it('con barrio: la sucursal de ese barrio, con el total de sucursales publicadas', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', filters: 'neighborhood:CORDON' })
    expect(cards(response)).toContainEqual(['costa-cordon', 4, []])
    expect(response.results.filter((result) => result.branchCount === 4)).toHaveLength(1)
  })

  it('con ubicación: la más cercana', async () => {
    const { store } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', loc: 'near', userLocation: '-34.9,-56.16' })
    const costaCard = response.results.find((result) => result.branchCount === 4)
    expect(costaCard?.id).toBe('costa-cordon')
    expect(costaCard?.branches.map((branch) => branch.id).sort()).toEqual(['costa-malvin', 'costa-pocitos'])
  })

  it('las sucursales escondidas no cuentan para armar secciones', async () => {
    const plain = Array.from({ length: 8 }, (_, index) => row({ id: `cafe-${index}`, categories: ['cafe'], prominence: index / 10 }))
    const { store } = fakeStore([...plain, ...places.slice(0, 3)])
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, intent: 'cafes', debug: true })
    expect(response.results).toHaveLength(9)
    expect(response.sections).toBeNull()
    expect(response.debug?.sections.notGrouped).toBe('menos de 12 resultados')
  })
})

describe('invitación a ampliar (widen)', () => {
  const vegan = { vegan: 'has_options', vegetarian: 'unknown', glutenFree: 'unknown' }
  const open = everyDay('09:00', '23:59')
  const closedToday = { slots: [{ day: 3, opens: '09:00', closes: '18:00' }], status: 'exact' as const }
  const places = [
    ...Array.from({ length: 3 }, (_, index) => row({ id: `cordon-vegan-${index}`, diet: vegan, hours: open })),
    ...Array.from({ length: 5 }, (_, index) => row({ id: `pocitos-vegan-${index}`, neighborhoodId: 'POCITOS', diet: vegan, hours: open })),
    ...Array.from({ length: 2 }, (_, index) => row({ id: `cordon-${index}`, hours: open })),
    row({ id: 'cordon-vegan-closed', diet: vegan, hours: closedToday }),
  ]

  it('cuenta cuántos más saldrían sin cada filtro: de mayor a menor, como mucho 2, sin pagar nada nuevo', async () => {
    const { store } = fakeStore(places)
    const { cache, interpreted, embedded } = fakeCache()
    const response = await runSearch('comer', { store, cache }, { now, filters: 'neighborhood:CORDON,diet:vegan,open:today', widen: true })
    expect(response.results).toHaveLength(3)
    // Sin Cordón: 5 de Pocitos; sin vegano: 2; sin "Abre hoy": 1 (queda afuera por el tope).
    expect(response.widen).toEqual([
      { kind: 'neighborhood', id: 'CORDON', label: 'Cordón', fromText: false, fromFilter: true, count: 5 },
      { kind: 'diet', id: 'vegan', label: expect.any(String), fromText: false, fromFilter: true, count: 2 },
    ])
    // Sólo SQL: el embedding de la consulta es el de siempre y no se llama al modelo.
    expect(interpreted).toHaveLength(0)
    expect(embedded).toEqual(['comer'])
  })

  it('sin la opción, no se calcula', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('comer', { store, cache: fakeCache().cache }, { now, filters: 'neighborhood:CORDON' })
    expect(response.widen).toBeUndefined()
    expect(calls).toHaveLength(1)
  })

  it('un sub-filtro también se ofrece', async () => {
    const bars = [
      ...Array.from({ length: 2 }, (_, index) => row({ id: `music-${index}`, categories: ['bar'], tags: ['live_music'] })),
      ...Array.from({ length: 3 }, (_, index) => row({ id: `bar-${index}`, categories: ['bar'] })),
    ]
    const response = await runSearch('', { store: fakeStore(bars).store, cache: fakeCache().cache }, { now, intent: 'bars', sub: 'live_music', widen: true })
    expect(response.results).toHaveLength(2)
    expect(response.widen).toEqual([{ kind: 'sub', id: 'live_music', label: 'Música en vivo', fromText: false, fromFilter: false, count: 3 }])
  })

  it('lo que ya se relajó o no suma nada no se ofrece', async () => {
    // En Cordón el único vegano cierra hoy y no hay nada cerca: "Abre hoy" se suelta y ya no se ofrece. El barrio nunca
    // se suelta: se sigue ofreciendo (los 5 de Pocitos), y la dieta suma los 2 de Cordón.
    const { store } = fakeStore(places.filter((place) => !/^cordon-vegan-\d$/.test(place.id)))
    const relaxed = await runSearch('comer', { store, cache: fakeCache().cache }, { now, filters: 'neighborhood:CORDON,diet:vegan,open:today', widen: true })
    expect(relaxed.relaxed.map((notice) => notice.what)).toEqual(['openAt'])
    expect(relaxed.results.map((result) => result.id)).toEqual(['cordon-vegan-closed'])
    expect(relaxed.widen).toEqual([
      { kind: 'neighborhood', id: 'CORDON', label: 'Cordón', fromText: false, fromFilter: true, count: 5 },
      { kind: 'diet', id: 'vegan', label: expect.any(String), fromText: false, fromFilter: true, count: 2 },
    ])

    const nothing = await runSearch('comer', { store: fakeStore(places.slice(0, 3)).store, cache: fakeCache().cache }, { now, filters: 'neighborhood:CORDON', widen: true })
    expect(nothing.widen).toEqual([])
  })
})

describe('Cerca de <barrio>', () => {
  const dish = ['milanesa napolitana']
  const inPocitos = [
    row({ id: 'pocitos-has', neighborhoodId: 'POCITOS', dishes: dish }),
    row({ id: 'pocitos-club', neighborhoodId: 'POCITOS', dishes: dish, brandKey: 'club', brandCount: 2 }),
  ]
  const around = [
    row({ id: 'cerca-maybe', neighborhoodId: 'PUNTA CARRETAS', tags: ['milanesa'], edgeDistance: 50 }),
    row({ id: 'cerca-has-lejos', neighborhoodId: 'BUCEO', dishes: dish, edgeDistance: 400 }),
    row({ id: 'cerca-has', neighborhoodId: 'PARQUE RODO', dishes: dish, edgeDistance: 120 }),
    // Otra sucursal de una marca que ya salió en el barrio: no se repite.
    row({ id: 'cerca-club', neighborhoodId: 'PARQUE RODO', dishes: dish, brandKey: 'club', brandCount: 2, edgeDistance: 10 }),
    // Lejos: no tiene edgeDistance.
    row({ id: 'lejos', neighborhoodId: 'CARRASCO', dishes: dish }),
  ]
  const search = (places: ReturnType<typeof row>[], options: Parameters<typeof runSearch>[2] = {}, query = 'milanesa napolitana', names: Parameters<typeof fakeStore>[1] = []) => {
    const store = fakeStore(places, names)
    return { ...store, response: runSearch(query, { store: store.store, cache: fakeCache().cache }, { now, filters: 'neighborhood:POCITOS', ...options }) }
  }

  it('el barrio queda igual y abajo van los cercanos: primero los "has", por distancia al borde, sin repetir marcas', async () => {
    const { response, calls, nearbyCalls } = search([...inPocitos, ...around])
    const { response: alone } = search(inPocitos)
    const [withNearby, withoutNearby] = await Promise.all([response, alone])
    expect(withNearby.results).toEqual(withoutNearby.results)
    expect(withNearby.relaxed).toEqual([])
    expect(withNearby.nearby).toMatchObject({ title: 'Cerca de Pocitos', label: 'Pocitos', total: 3 })
    expect(withNearby.nearby?.results.map((result) => [result.id, result.matchLevel])).toEqual([['cerca-has', 'has'], ['cerca-has-lejos', 'has'], ['cerca-maybe', 'maybe']])
    expect(withNearby.nearbyOnly).toBeNull()
    // Una consulta del barrio y otra de los cercanos, con los mismos filtros salvo el barrio.
    expect(calls).toHaveLength(1)
    expect(nearbyCalls).toHaveLength(1)
    const { nearby, neighborhoods, ...rest } = nearbyCalls[0].filters
    const { nearby: none, neighborhoods: wanted, ...same } = calls[0].filters
    expect([neighborhoods, wanted, none, nearby?.exclude, nearby?.polygons.length]).toEqual([[], ['POCITOS'], undefined, ['POCITOS'], 1])
    expect(rest).toEqual(same)
  })

  it('las dos consultas van en paralelo', async () => {
    const { store } = fakeStore([...inPocitos, ...around])
    let inFlight = 0
    let most = 0
    const slow = {
      ...store,
      async candidates(...args: Parameters<typeof store.candidates>) {
        most = Math.max(most, ++inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        return store.candidates(...args)
      },
    }
    await runSearch('milanesa napolitana', { store: slow, cache: fakeCache().cache }, { now, filters: 'neighborhood:POCITOS' })
    expect(most).toBe(2)
  })

  it('el grupo muestra hasta maxPlaces y total cuenta todos', async () => {
    const many = Array.from({ length: 8 }, (_, index) => row({ id: `cerca-${index}`, neighborhoodId: 'BUCEO', dishes: dish, edgeDistance: 100 + index }))
    const response = await search([...inPocitos, ...many]).response
    expect(response.nearby?.total).toBe(8)
    expect(response.nearby?.results.map((result) => result.id)).toEqual(['cerca-0', 'cerca-1', 'cerca-2', 'cerca-3', 'cerca-4', 'cerca-5'])
  })

  it('el barrio sin resultados: el aviso y el grupo, sin "no encontramos" de cero', async () => {
    const response = await search(around).response
    expect(response.results).toEqual([])
    expect(response.relaxed).toEqual([{ what: 'neighborhood', message: 'No encontramos en Pocitos; estos están cerca.' }])
    expect(response.nearby?.results.map((result) => result.id)).toEqual(['cerca-club', 'cerca-has', 'cerca-has-lejos', 'cerca-maybe'])
  })

  it('"Ver todos" (nearby:1): todos los cercanos en el orden del grupo, sin agrupar, con el extra para quitarlo', async () => {
    const response = await search([...inPocitos, ...around], { filters: 'neighborhood:POCITOS,nearby:1', debug: true }).response
    expect(response.results.map((result) => result.id)).toEqual(['cerca-has', 'cerca-has-lejos', 'cerca-maybe'])
    expect(response.nearby).toBeNull()
    expect(response.nearbyOnly).toEqual({ title: 'Cerca de Pocitos', label: 'Pocitos' })
    expect(response.sections).toBeNull()
    expect(response.bar.extras).toContainEqual({ kind: 'nearby', id: '1', label: 'Cerca de Pocitos', fromText: false, fromFilter: true })
    // Debug, en el mismo orden; después, lo que no se muestra (la sucursal de la marca del barrio).
    expect(response.debug?.results.map((result) => [result.id, result.edgeDistance])).toEqual([['cerca-has', 120], ['cerca-has-lejos', 400], ['cerca-maybe', 50], ['cerca-club', 10]])
  })

  it('sin barrio, o con un lugar fijado por nombre, no hay grupo ni consulta de cercanos', async () => {
    const noNeighborhood = search([...inPocitos, ...around], { filters: null })
    expect((await noNeighborhood.response).nearby).toBeNull()
    expect(noNeighborhood.nearbyCalls).toHaveLength(0)
    // nearby:1 sin barrio no hace nada.
    const orphan = await search([...inPocitos, ...around], { filters: 'nearby:1' }).response
    expect([orphan.nearbyOnly, orphan.bar.extras.some((chip) => chip.kind === 'nearby')]).toEqual([null, false])

    const pinned = search([...inPocitos, ...around], {}, 'la pasiva', [{ id: 'pocitos-has', name: 'La Pasiva', similarity: 0.95, wordSimilarity: 1 }])
    expect((await pinned.response).nearby).toBeNull()
    expect(pinned.nearbyCalls).toHaveLength(0)
  })
})

describe('keywords', () => {
  const edits = { removed: false, removedWords: new Set<string>(), shortcut: true }
  const keywords = (query: string) => {
    const normalized = normalizeQuery(query)
    return keywordsFor(normalized, interpretWithDictionary(normalized, { partial: true }) ?? emptyInterpretation(), edits)
  }

  it('el verbo que eligió la intención no va como keyword ("tomar algo" empataba a casi todos)', () => {
    expect(keywords('tomar algo')).toEqual([])
    expect(keywords('salir a comer con amigos')).toEqual(['amigos'])
    expect(keywords('ir a tomar algo')).toEqual([])
    expect(keywords('grab a drink')).toEqual(['drink'])
    expect(keywords('comer carne')).toEqual(['carne'])
  })

  it('las palabras de horario ya están en openAt: no van como keyword ni al nombre', () => {
    expect(keywords('tomar algo tarde un martes')).toEqual([])
    expect(keywords('cena el viernes a la noche')).toEqual(['cena'])
    expect(keywords('merendar a la tarde')).toEqual(['merendar'])
    expect(nameWordsFor('tomar algo tarde un martes', new Set())).toEqual([])
    expect(nameWordsFor('pizza hoy', new Set())).toEqual(['pizza'])
  })

  it('sin intención del texto el verbo sigue siendo keyword; "unas" y "algo" nunca', () => {
    expect(keywordsFor('tomar mate', emptyInterpretation(), edits)).toEqual(['tomar', 'mate'])
    expect(keywords('tomar unas birras')).toEqual(['birras'])
    expect(keywordsFor('algo con unos amigos', emptyInterpretation(), edits)).toEqual(['amigos'])
  })
})

describe('encaje con la intención y la sección', () => {
  const { barFit, sectionFit } = SEARCH_CONFIG.boosts
  const matute = row({ id: 'matute', categories: ['brewery', 'bar', 'restaurant'], iconCategory: 'beer_pub' })
  const yuzu = row({ id: 'yuzu', categories: ['bar', 'restaurant'], iconCategory: 'sushi' })

  it('con Bares, el lugar conocido por la bebida suma barFit; el sushi con barra no (y no resta)', () => {
    expect(boostsFor(matute, context({ intent: 'bars' }), null).barFit).toBe(barFit)
    expect(boostsFor(yuzu, context({ intent: 'bars' }), null)).toEqual({})
    expect(boostsFor(matute, context({ intent: 'eat' }), null).barFit).toBeUndefined()
    expect(boostsFor(matute, context(), null).barFit).toBeUndefined()
  })

  it('con Comer, el lugar conocido por un plato suma eatFit; café, desayuno o bebida no (y no restan)', () => {
    const { eatFit } = SEARCH_CONFIG.boosts
    for (const icon of ['grill', 'pasta', 'sushi', 'salad'] as const) {
      expect(boostsFor(row({ id: icon, iconCategory: icon }), context({ intent: 'eat' }), null).eatFit).toBe(eatFit)
    }
    for (const icon of ['coffee', 'breakfast', 'pancakes', 'ice_cream', 'beer_pub'] as const) {
      expect(boostsFor(row({ id: icon, categories: ['cafe'], iconCategory: icon }), context({ intent: 'eat' }), null)).toEqual({})
    }
    // Restaurante o bodegón con ícono de café o bar: la mitad, para seguir por debajo del ícono de comida.
    for (const categories of [['restaurant'], ['bodegon', 'bar']]) {
      expect(boostsFor(row({ id: 'savarin', categories, iconCategory: 'coffee' }), context({ intent: 'eat' }), null).eatFit).toBe(eatFit / 2)
    }
    expect(boostsFor(row({ id: 'parrilla', categories: ['restaurant'], iconCategory: 'grill' }), context({ intent: 'eat' }), null).eatFit).toBe(eatFit)
    expect(boostsFor(yuzu, context({ intent: 'bars' }), null).eatFit).toBeUndefined()
    expect(boostsFor(yuzu, context(), null).eatFit).toBeUndefined()
    expect(eatFit).toBe(barFit)
  })

  it('a parecido semántico similar, el bar de verdad pasa adelante', () => {
    const rows = [row({ ...yuzu, semantic: 0.31 }), row({ ...matute, semantic: 0.28 })]
    expect(fuse(rows, buildRankings(rows), context({ intent: 'bars' })).map((item) => item.row.id)).toEqual(['matute', 'yuzu'])
  })

  it('Ver todos de Para compartir: picada + tapas + groups suma más que sólo tapas', () => {
    const section = context({ section: 'share' })
    expect(boostsFor(row({ id: 'todo', tags: ['picada', 'tapas', 'groups'] }), section, null).sectionFit).toBeCloseTo(3 * sectionFit)
    expect(boostsFor(row({ id: 'tapas', tags: ['tapas'] }), section, null).sectionFit).toBe(sectionFit)
    // groups solo no hace entrar a nadie, pero ordena.
    expect(boostsFor(row({ id: 'grupos', tags: ['groups'] }), section, null).sectionFit).toBe(sectionFit)
    expect(boostsFor(row({ id: 'todo', tags: ['picada', 'tapas', 'groups'] }), context(), null).sectionFit).toBeUndefined()
  })
})

describe('descuentos', () => {
  const itau = { provider: 'itau', cardType: 'credit' } as const
  const bbvaDebit = { provider: 'bbva', cardType: 'debit' } as const
  const santanderOther = { provider: 'santander', cardType: 'other' } as const
  const places = [
    row({ id: 'both', prominence: 0.9, discounts: [bbvaDebit, itau] }),
    row({ id: 'itau-only', prominence: 0.8, discounts: [itau] }),
    row({ id: 'bbva-only', prominence: 0.7, discounts: [bbvaDebit] }),
    row({ id: 'santander-other', prominence: 0.6, discounts: [santanderOther] }),
    row({ id: 'none', prominence: 0.5 }),
  ]
  const search = (filters: string | null) => runSearch('', { store: fakeStore(places).store, cache: fakeCache().cache }, { now, filters, debug: true })
  const ids = (response: Awaited<ReturnType<typeof search>>) => response.results.map((result) => result.id).sort()

  it('sin filtro, la card muestra todos los proveedores del lugar en el orden de la config', async () => {
    const response = await search(null)
    expect(Object.fromEntries(response.results.map((result) => [result.id, result.discounts.map((provider) => provider.name)]))).toEqual({
      both: ['Itaú', 'BBVA'],
      'itau-only': ['Itaú'],
      'bbva-only': ['BBVA'],
      'santander-other': ['Santander'],
      none: [],
    })
  })

  it('un proveedor y crédito: sólo esos lugares, la card dice sólo ese proveedor y no hay grupos por descuento', async () => {
    const { store, calls } = fakeStore(places)
    const response = await runSearch('', { store, cache: fakeCache().cache }, { now, filters: 'discount:itau.credit', debug: true })
    expect(calls[0].filters.discounts).toEqual([{ provider: 'itau', card: 'credit' }])
    expect(response.debug?.source).toBe('filters')
    expect(response.results.map((result) => result.id)).toEqual(['both', 'itau-only'])
    expect(response.results.every((result) => result.discounts.map((provider) => provider.id).join() === 'itau')).toBe(true)
    expect(response.sections?.some((section) => section.id.startsWith('discount:')) ?? false).toBe(false)
  })

  it('"other" (sin especificar) cumple débito y crédito de su proveedor', async () => {
    expect(ids(await search('discount:santander.debit'))).toEqual(['santander-other'])
    expect(ids(await search('discount:santander.credit'))).toEqual(['santander-other'])
  })

  it('varios: OR entre elecciones; con dos proveedores se agrupa por proveedor y un lugar con los dos va en ambos', async () => {
    const response = await search('discount:bbva.debit,discount:itau.credit')
    expect(ids(response)).toEqual(['bbva-only', 'both', 'itau-only'])
    expect(response.sections).toEqual([
      { id: 'discount:itau', title: 'Con descuento Itaú', placeIds: ['both', 'itau-only'], total: 2 },
      { id: 'discount:bbva', title: 'Con descuento BBVA', placeIds: ['both', 'bbva-only'], total: 2 },
    ])
    expect(response.forYou).toBeNull()
    expect(response.debug?.sections.notGrouped).toBe('agrupado por descuento')
    expect(response.results.find((result) => result.id === 'both')?.discounts).toEqual([{ id: 'itau', name: 'Itaú' }, { id: 'bbva', name: 'BBVA' }])
  })

  it('nunca se relaja: sin lugares que cumplan, cero resultados; no cambia el orden', async () => {
    expect((await search('discount:itau.debit')).results).toEqual([])
    const all = (await search(null)).results.map((result) => result.id).filter((id) => ['both', 'itau-only'].includes(id))
    expect((await search('discount:itau.credit')).results.map((result) => result.id)).toEqual(all)
  })
})
