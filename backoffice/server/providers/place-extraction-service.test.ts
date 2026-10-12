import { describe, expect, it, vi } from 'vitest'
import { getNeighborhood } from '../../src/lib/getNeighborhood.ts'
import {
  PlaceExtractionService,
  filterSources,
  classifyContact,
  classifySource,
  deduplicateSourceText,
  extractionModelConfig,
  postProcess,
  providerOptionsFor,
  reviewExtraction,
  slotsFromBlocks,
  resolveDeterministicContact,
  SYSTEM_PROMPT,
  HOURS_RETRY_PROMPT,
  hoursModelConfig,
  llmUsageCost,
  mainExtractionRequest,
  mentionsAddress,
  type PlaceExtraction,
  type Source,
} from './place-extraction-service.ts'

const target = {
  name: 'Café Brasilero',
  address: 'Ituzaingó 1447',
  coordinates: { lat: -34.906, lng: -56.202, source: 'google' as const, fetchedAt: '2026-10-01T00:00:00.000Z' },
  neighborhoodId: 'CIUDAD VIEJA',
  city: 'Montevideo' as const,
  googlePlaceId: 'place-1',
  transit: { status: 'success' as const, lines: [] },
}

const extraction: PlaceExtraction = {
  facts: [{ id: 'F1', text: 'sirve desayunos', sourceId: 'S1', kind: 'food', proposedTag: null }],
  tags: [
    { group: 'categories', id: 'cafe', facts: ['F1'] }, { group: 'moments', id: 'breakfast', facts: ['F1'] }, { group: 'foods', id: 'pastries', facts: ['F1'] },
    { group: 'drinks', id: 'specialty_coffee', facts: ['F1'] }, { group: 'features', id: 'wifi', facts: ['F1'] }, { group: 'goodFor', id: 'work', facts: ['F1'] },
  ],
  dietary: { vegan: 'unknown', vegetarian: 'has_options', glutenFree: 'unknown' },
  price: 'moderate', reservations: 'unknown',
  hours: { raw: 'Lunes 08:00 a 19:00', display: null, blocks: [{ days: [1], opens: '08:00', closes: '19:00' }] },
  contact: { phone: '2915 0000', whatsapp: null, instagram: 'cafebrasilero', website: 'https://cafe.example/', menuUrl: null, reservationUrl: null },
  highlights: [{ es: 'flat white', en: 'flat white', facts: ['F1'] }],
  description: { es: 'Un café histórico para hacer una pausa.', en: 'A historic café for a relaxed break.' },
  locatedIn: null,
  support: [],
  doubts: [],
}

// Extracción vacía del modelo: cada test agrega sólo lo que necesita.
const emptyExtraction: PlaceExtraction = {
  ...extraction,
  facts: [], tags: [], highlights: [],
  hours: { raw: null, display: null, blocks: [] }, support: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function exaResponse(instagram = '', results: { title: string; url: string; highlights: string[] }[] = []) {
  return {
    source: 'exa' as const,
    query: `${target.name}, Montevideo, Uruguay`,
    output: {
      content: {
        description: '',
        address: target.address,
        contact_info: instagram ? `Instagram: ${instagram}` : '',
        open_hours_raw: '', open_hours: [],
        knows_before_you_go: '',
        menu: [],
      },
      grounding: {},
    },
    results,
    requestId: 'exa-1',
    attribution: 'Exa',
  }
}

const googleDetails = {
  source: 'google' as const,
  exactMatch: true as const,
  anchor: {
    name: target.name,
    address: target.address,
    latitude: target.coordinates.lat,
    longitude: target.coordinates.lng,
  },
  websiteUri: null,
  data: {},
  attribution: 'Google Maps',
}

describe('PlaceExtractionService', () => {
  it('filtra fuentes bloqueadas y produce el borrador', () => {
    expect(filterSources([
      { id: 'S1', kind: 'web', url: 'https://cafe.example/', text: 'Café de especialidad' },
      { id: 'S2', kind: 'web', url: 'https://www.google.com/maps', text: 'No usar' },
    ])).toHaveLength(1)

    const place = postProcess(target, {
      ...extraction,
      facts: [{ id: 'F1', text: 'es un café de especialidad', sourceId: 'S1', kind: 'other', proposedTag: null }],
      tags: [{ group: 'categories', id: 'cafe', facts: ['F1'] }],
    }, { sources: [{ id: 'S1', kind: 'web', trust: 'official', url: 'https://cafe.example/', text: 'Café de especialidad' }] })

    expect(place.neighborhoodId).toBe('CIUDAD VIEJA')
    expect(place.coordinates).toEqual({ lat: -34.906, lng: -56.202, source: 'google', fetchedAt: '2026-10-01T00:00:00.000Z' })
    expect(place.categories).toEqual(['cafe'])
    expect(place).not.toHaveProperty('provenance')
    expect(place.embeddingText).not.toContain('coffee shop')
    expect(place.keywordText).toContain('coffee shop')
  })

  it('incluye Exa aunque no haya fuentes web o Instagram', async () => {
    let generated = false
    let sourceKinds: string[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ source: 'google', exactMatch: true, anchor: { name: target.name, address: target.address, latitude: target.coordinates.lat, longitude: target.coordinates.lng }, websiteUri: null, data: {}, attribution: 'Google Maps' }) },
      exa: { configured: true, searchPlace: async () => ({ source: 'exa', query: 'Café Brasilero, Montevideo, Uruguay', output: { content: { description: '', address: target.address, contact_info: '', open_hours_raw: '', open_hours: [], knows_before_you_go: '', menu: [] }, grounding: {} }, results: [{ title: target.name, url: 'https://cafe.example/', highlights: ['Café Brasilero'] }], requestId: 'exa-1', attribution: 'Exa' }) },
      generate: async (_target, sources) => { generated = true; sourceKinds = sources.map((source) => source.kind); return extraction },
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result.status).toBe('ok')
    expect(generated).toBe(true)
    expect(sourceKinds).toEqual(['exa', 'exa'])
    expect(result.sourceAudit).toEqual({
      google: true, exa: true, instagram: false, instagramCandidates: [],
      instagramSelection: { handle: null, origin: null, candidates: [] },
    })
  })

  it('devuelve el costo por proveedor con el uso real de tokens del LLM', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri: 'https://cafe.example/' }) },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero', [{ title: target.name, url: 'https://cafe.example/menu', highlights: ['Café Brasilero'] }]) },
      instagram: { configured: true, scrapeMany: async () => [{ url: 'https://www.instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [] }] },
      website: { configured: true, scrape: async () => ({ url: 'https://cafe.example/', title: target.name, description: '', content: 'Café de especialidad', instagramUrls: [] }) },
      transit: { findNearbyLines: async () => ({ status: 'success', lines: [] }) },
      generate: async () => ({ data: extraction, inputTokens: 1_000_000, cachedInputTokens: 200_000, outputTokens: 100_000, gatewayCostUsd: 0.4 }),
      model: { model: 'openai/gpt-5-mini', reasoning: 'low' },
      costRates: {
        googleDetailsRequestUsd: 1,
        exaSearchRequestUsd: 2,
        exaContentPageUsd: 3,
        instagramRunUsd: 4,
        scrapingRequestUsd: 5,
        transitRequestUsd: 6,
      },
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    // 800k tokens a 0,25 + 200k cacheados a 0,025 + 100k de salida a 2 (USD por millón).
    expect(result.model).toBe('openai/gpt-5-mini')
    expect(result.performance.costUsd).toEqual({
      currency: 'USD',
      estimated: false,
      totalUsd: 21.405,
      providers: {
        google: { requests: 1, costUsd: 1 },
        exa: { requests: 1, contentPages: 1, highlightPages: 0, costUsd: 5 },
        instagram: { requests: 1, costUsd: 4 },
        scraping: { requests: 1, costUsd: 5 },
        transit: { requests: 1, costUsd: 6 },
        llm: {
          model: 'openai/gpt-5-mini', inputTokens: 1_000_000, cachedInputTokens: 200_000, cacheWriteTokens: null, outputTokens: 100_000, gatewayCostUsd: 0.4,
          inputCostUsd: 0.205, outputCostUsd: 0.2, costUsd: 0.405,
        },
      },
    })
  })

  it('consulta Google primero, luego Exa con su nombre y buses, Apify y finalmente el LLM con buses', async () => {
    const detailsRun = deferred<typeof googleDetails>()
    const exaRun = deferred<ReturnType<typeof exaResponse>>()
    const transitRun = deferred<{ status: 'success'; lines: [] }>()
    const instagramRun = deferred<{
      url: string
      name: string
      bio: string
      links: string[]
      posts: string[]
    }[]>()
    const llmRun = deferred<PlaceExtraction>()
    const events: string[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: vi.fn(() => { events.push('google'); return detailsRun.promise }) },
      exa: { configured: true, searchPlace: vi.fn(() => { events.push('exa'); return exaRun.promise }) },
      transit: { findNearbyLines: vi.fn(() => { events.push('buses'); return transitRun.promise }) },
      instagram: { configured: true, scrapeMany: vi.fn(() => { events.push('instagram'); return instagramRun.promise }) },
      generate: vi.fn(() => { events.push('llm'); return llmRun.promise }),
    })

    const resultPromise = service.extract('place-1', { seedCategories: ['cafe'] })
    expect(events).toEqual(['google'])

    detailsRun.resolve(googleDetails)
    await vi.waitFor(() => expect(events).toEqual(expect.arrayContaining(['exa', 'buses'])))
    expect(events).not.toContain('instagram')

    exaRun.resolve(exaResponse('@cafebrasilero'))
    await vi.waitFor(() => expect(events).toContain('instagram'))
    expect(events).not.toContain('llm')

    instagramRun.resolve([{
      url: 'https://www.instagram.com/cafebrasilero/',
      name: target.name,
      bio: 'Café histórico en Montevideo, Uruguay',
      links: [],
      posts: ['Café todos los días'],
    }])
    // Las fuentes incluyen los buses: el LLM arranca cuando terminan.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(events).not.toContain('llm')
    transitRun.resolve({ status: 'success', lines: [] })
    await vi.waitFor(() => expect(events).toContain('llm'))
    expect(events.at(-1)).toBe('llm')

    llmRun.resolve(extraction)
    await expect(resultPromise).resolves.toMatchObject({
      status: 'ok',
      sourceAudit: { google: true, exa: true, instagram: true, instagramCandidates: ['cafebrasilero'] },
    })
  })

  it('deduplica el mismo Instagram de Google y Exa en una sola llamada de Apify', async () => {
    const scrapeMany = vi.fn().mockResolvedValue([{
      url: 'https://instagram.com/cafebrasilero/',
      name: target.name,
      bio: 'Montevideo, Uruguay',
      links: [],
    }])
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri: 'https://instagram.com/cafebrasilero/' }) },
      exa: { configured: true, searchPlace: async () => exaResponse('@CafeBrasilero') },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(scrapeMany).toHaveBeenCalledOnce()
    expect(scrapeMany).toHaveBeenCalledWith(['https://www.instagram.com/cafebrasilero/'])
    expect(result.sourceAudit.instagramCandidates).toEqual(['cafebrasilero'])
    expect(result.sourceAudit.instagram).toBe(true)
  })

  it('no elige Instagram cuando dos perfiles distintos son válidos', async () => {
    let sourceKinds: string[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: {
        configured: true,
        searchPlace: async () => ({
          ...exaResponse('@cafebrasilero', [{ title: 'Nota', url: 'https://guia.example/cafe', highlights: ['Café Brasilero en Montevideo'] }]),
          results: [{
            title: 'Nota',
            url: 'https://guia.example/cafe',
            highlights: ['Café Brasilero en Montevideo'],
            extras: { links: ['https://instagram.com/cafebrasilero2/'] },
          }],
        }),
      },
      instagram: {
        configured: true,
        scrapeMany: async (urls) => urls.map((url) => ({ url, name: target.name, bio: 'Montevideo, Uruguay', links: [] })),
      },
      generate: async (_place, sources) => { sourceKinds = sources.map((source) => source.kind); return extraction },
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result.sourceAudit).toMatchObject({
      exa: true,
      instagram: false,
      instagramCandidates: ['cafebrasilero', 'cafebrasilero2'],
    })
    expect(sourceKinds).toEqual(['exa', 'exa'])
  })

  it.each([
    ['perfil extranjero', async () => [{ url: 'https://instagram.com/cafebrasilero/', name: target.name, bio: 'São Paulo, Brasil', links: [] }]],
    ['handle de otro país', async () => [{ url: 'https://instagram.com/cafebrasilero.br/', name: target.name, bio: 'Café en Montevideo, Uruguay', links: [] }]],
    ['falla de Apify', async () => { throw new Error('Apify unavailable') }],
  ])('continúa sin Instagram ante %s', async (_caseName, scrapeMany) => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero') },
      instagram: { configured: true, scrapeMany },
      generate: async () => extraction,
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result).toMatchObject({
      status: 'ok',
      sourceAudit: { google: true, exa: true, instagram: false, instagramCandidates: ['cafebrasilero'] },
    })
  })

  it('continúa con Instagram de Google cuando Exa falla', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri: 'https://instagram.com/cafebrasilero/' }) },
      exa: { configured: true, searchPlace: async () => { throw new Error('Exa unavailable') } },
      instagram: {
        configured: true,
        scrapeMany: async () => [{ url: 'https://instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [] }],
      },
      generate: async () => extraction,
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result.sourceAudit).toEqual({
      google: true,
      exa: false,
      instagram: true,
      instagramCandidates: ['cafebrasilero'],
      instagramSelection: {
        handle: 'cafebrasilero', origin: 'official_profile',
        candidates: [{ handle: 'cafebrasilero', decision: 'selected', reason: 'validated_exact_place_profile' }],
      },
    })
  })

  it('limita Exa, el LLM y Apify entre extracciones concurrentes', async () => {
    const tracker = () => {
      const state = { active: 0, max: 0 }
      const run = async <T>(value: T) => {
        state.active += 1
        state.max = Math.max(state.max, state.active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        state.active -= 1
        return value
      }
      return { state, run }
    }
    const exa = tracker()
    const llm = tracker()
    const apify = tracker()
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: () => exa.run(exaResponse('@cafebrasilero')) },
      instagram: { configured: true, scrapeMany: () => apify.run([]) },
      generate: () => llm.run(extraction),
    })

    await Promise.all(Array.from({ length: 8 }, (_, index) => service.extract(`place-${index}`, { seedCategories: ['cafe'] })))

    expect(exa.state.max).toBe(3)
    expect(llm.state.max).toBe(3)
    expect(apify.state.max).toBe(2)
  })

  it('busca en Exa con el nombre que devuelve Google', async () => {
    const searchPlace = vi.fn(async () => exaResponse())
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace },
      generate: async () => extraction,
    })

    await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(searchPlace).toHaveBeenCalledWith(googleDetails.anchor.name)
  })

  it('usa el neighborhoodId recibido y, si no llega, lo calcula con las coordenadas', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: true, searchPlace: async () => exaResponse() },
      generate: async () => extraction,
    })

    const given = await service.extract('place-1', { seedCategories: ['cafe'], neighborhoodId: 'POCITOS' })
    const computed = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(given).toMatchObject({ status: 'ok', place: { neighborhoodId: 'POCITOS' } })
    expect(computed).toMatchObject({
      status: 'ok',
      place: { neighborhoodId: getNeighborhood(googleDetails.anchor.latitude, googleDetails.anchor.longitude).neighborhoodId },
    })
  })

  it('clasifica fuentes propias, directorios, reservas y bloqueados', () => {
    const context = { name: 'Café Brasilero', websiteUrl: 'https://cafebrasilero.uy/', instagramUrls: ['https://www.instagram.com/cafebrasilero/'] }
    expect(classifySource('https://cafebrasilero.uy/menu', context)).toBe('web')
    expect(classifySource('https://www.instagram.com/cafebrasilero/', context)).toBe('instagram')
    expect(classifySource('https://www.instagram.com/cafebrasilero.br/', context)).toBe('blocked')
    expect(classifySource('https://meitre.com/cafe-brasilero', context)).toBe('reservations')
    expect(classifySource('https://opina.com.uy/cafe-brasilero', context)).toBe('directory')
    for (const url of ['https://maps.google.com/', 'https://maps.app.goo.gl/x', 'https://exa.ai/library/x', 'https://tripadvisor.com/Restaurant', 'https://www.facebook.com/cafe', 'https://foursquare.com/v/cafe']) {
      expect(classifySource(url, context)).toBe('blocked')
    }
  })

  it('usa el resumen y resultados individuales de Exa, y registra bloqueos', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    let generatedSources: Source[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ source: 'google', exactMatch: true, anchor: { name: 'Café Brasilero', address: target.address, latitude: target.coordinates.lat, longitude: target.coordinates.lng }, websiteUri: null, data: {}, attribution: 'Google Maps' }) },
      exa: { configured: true, searchPlace: async () => ({ source: 'exa', query: 'Café Brasilero, Montevideo, Uruguay', output: { content: { description: 'SUMMARY_MUST_NOT_BE_A_SOURCE', address: '', contact_info: '', open_hours_raw: '', open_hours: [], knows_before_you_go: 'KNOWS_MUST_BE_PRESERVED', menu: [] }, grounding: { url: 'https://exa.ai/library/ignored' } }, results: [
        { title: 'Café Brasilero', url: 'https://cafebrasilero.uy/', highlights: ['Café histórico de Montevideo'] },
        { title: 'Bloqueado', url: 'https://exa.ai/library/no', highlights: ['No usar'] },
      ], requestId: 'exa-1', attribution: 'Exa' }) },
      generate: async (_target, sources) => {
        generatedSources = sources
        return emptyExtraction
      },
    })
    await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(generatedSources).toEqual([
      expect.objectContaining({ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/' }),
      expect.objectContaining({ id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://cafebrasilero.uy/', text: 'Café histórico de Montevideo' }),
    ])
    expect(generatedSources[0].text).toContain('SUMMARY_MUST_NOT_BE_A_SOURCE')
    expect(generatedSources[0].text).toContain('KNOWS_MUST_BE_PRESERVED')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"blockedDomains":["exa.ai"]'))
    log.mockRestore()
  })

  it('prioriza precios determinísticos por persona y respeta sus límites', () => {
    const priceFrom = (sources: { id: string; kind: 'web'; trust: 'official' | 'third_party'; url: string; text: string }[]) => postProcess(target, {
      ...extraction,
      price: 'very_high',
      support: [],
    }, { sources })

    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'El gasto es de $700 a $1.100 por persona.',
    }]).price).toBe('moderate')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $ 599 por persona.',
    }]).price).toBe('low')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $1.200 por persona.',
    }]).price).toBe('high')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $2.500 por persona.',
    }]).price).toBe('high')
    expect(priceFrom([{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio $2.501 por persona.',
    }]).price).toBe('very_high')
  })

  it('usa la mediana de precios oficiales e ignora importes ajenos o en otra moneda', () => {
    const place = postProcess(target, {
      ...extraction,
      price: 'very_high',
      support: [],
    }, { sources: [
      {
        id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
        text: 'Precio promedio $700 por persona. Precio promedio $1.300 por persona.',
      },
      {
        id: 'S2', kind: 'directory', trust: 'third_party', url: 'https://directorio.example/',
        text: 'Precio promedio $5.000 por persona.',
      },
    ] })
    expect(place.price).toBe('moderate')

    const noPrice = postProcess(target, { ...extraction, price: 'high', support: [] }, { sources: [{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio US$ 25 por persona. Copa $500.',
    }] })
    expect(noPrice.price).toBe('unknown')
  })

  it('deduplica líneas repetidas y reporta el ahorro estimado de entrada', () => {
    const result = deduplicateSourceText([
      { id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/', text: 'Tarta de estación\nSpritz cítrico\nPatio' },
      { id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://example.com/', text: 'Spritz cítrico\nPatio\nTerraza' },
    ])
    expect(result.sources).toEqual([
      expect.objectContaining({ id: 'S1', text: 'Tarta de estación\nSpritz cítrico\nPatio' }),
      expect.objectContaining({ id: 'S2', text: 'Terraza' }),
    ])
    expect(result.stats.afterChars).toBeLessThan(result.stats.beforeChars)
    expect(result.stats.estimatedInputTokensSaved).toBeGreaterThan(0)
  })

  it('audita un handle de Exa aunque el candidato de Instagram quede descartado', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: {
        configured: true,
        searchPlace: async () => {
          const response = exaResponse()
          return {
            ...response,
            results: [{ title: 'Instagram', url: 'https://example.com/', highlights: [], extras: { links: ['https://instagram.com/magnolio.uy/'] } }],
            output: { content: { ...response.output.content, contact_info: 'Instagram: @oriundo.uy' }, grounding: {} },
          }
        },
      },
      generate: async () => ({
        ...emptyExtraction,
        facts: [{ id: 'F1', text: 'su Instagram es @oriundo.uy', sourceId: 'S1', kind: 'contact', proposedTag: null }],
        contact: { ...extraction.contact, instagram: 'oriundo.uy' },
        support: [{ field: 'contact.instagram', facts: ['F1'] }],
      }),
    })

    const result = await service.extract('place-1', { seedCategories: ['cafe'] })
    expect(result).toMatchObject({
      status: 'ok',
      sourceAudit: {
        instagram: false,
        instagramCandidates: ['oriundo.uy', 'magnolio.uy'],
        instagramSelection: {
          handle: 'oriundo.uy', origin: 'exa_summary',
          candidates: [
            { handle: 'oriundo.uy', decision: 'unavailable', reason: 'instagram_provider_not_configured' },
            { handle: 'magnolio.uy', decision: 'unavailable', reason: 'instagram_provider_not_configured' },
          ],
        },
      },
    })
  })

  it('resuelve contactos determinísticos desde Google, texto y links', () => {
    const sources = [{
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://example.com/',
      text: 'Reservas https://oriundo.meitre.com/ · Instagram: @magnolio.uy · Correo: @oriundo.uy · Tel: 099 111 222',
      links: ['https://instagram.com/magnolio.uy/', 'https://instagram.com/oriundo.uy/'],
    }]
    const contact = resolveDeterministicContact({
      ...googleDetails,
      anchor: { ...googleDetails.anchor, name: 'Oriundo' },
      websiteUri: 'https://oriundo.uy/',
      phoneNumber: null,
    }, sources)

    expect(contact).toEqual({
      website: 'https://oriundo.uy/',
      reservationUrl: 'https://oriundo.meitre.com/',
      instagram: 'oriundo.uy',
      phone: '+598 99 111 222',
    })
    expect(resolveDeterministicContact({
      ...googleDetails,
      websiteUri: 'https://oriundo.meitre.com/',
      phoneNumber: '+598 2418 5404',
    }, sources)).toMatchObject({
      website: null,
      reservationUrl: 'https://oriundo.meitre.com/',
      phone: '+598 2418 5404',
    })
    expect(resolveDeterministicContact({ ...googleDetails, websiteUri: 'https://instagram.com/oriundo.uy/' }, [])).not.toHaveProperty('website')
    expect(resolveDeterministicContact({ ...googleDetails, websiteUri: null }, [{
      ...sources[0], links: ['https://book.example/reserva'], text: 'Reservas https://book.example/reserva',
    }], ['book.example'])).toMatchObject({ reservationUrl: 'https://book.example/reserva' })
  })

  it('extrae handles aislados de todas las fuentes y descarta emails', () => {
    const contact = resolveDeterministicContact({
      ...googleDetails,
      anchor: { ...googleDetails.anchor, name: 'Oriundo' },
      websiteUri: null,
    }, [{
      id: 'S1', kind: 'directory', trust: 'third_party', url: 'https://alacarta.com.uy/oriundo/',
      text: 'Correo: @oriundo.uy',
    }])
    expect(contact.instagram).toBe('oriundo.uy')

    const emailOnly = resolveDeterministicContact({
      ...googleDetails,
      anchor: { ...googleDetails.anchor, name: 'Culto Café' },
      websiteUri: null,
    }, [{
      id: 'S1', kind: 'directory', trust: 'third_party', url: 'https://alacarta.com.uy/culto-cafe/',
      text: 'Correo: hola@cultocafe.uy',
    }])
    expect(emailOnly).not.toHaveProperty('instagram')
  })

  it('preserva la semilla y aplica el contacto determinístico sobre el LLM', () => {
    const place = postProcess(target, {
      ...extraction,
      tags: [{ group: 'categories', id: 'wine_bar', facts: ['F1'] }],
      reservations: 'no_reservations',
      contact: { ...extraction.contact, phone: '000', instagram: 'marca-ajena', website: 'https://incorrecta.example/', reservationUrl: null },
      facts: [{ id: 'F1', text: 'es un wine bar', sourceId: 'S1', kind: 'other', proposedTag: null }],
      support: [],
    }, {
      seedCategories: ['bar'],
      sources: [{ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://example.com/', text: 'wine bar' }],
      deterministicContact: {
        phone: '+598 2418 5404', instagram: 'oriundo.uy', website: null, reservationUrl: 'https://oriundo.meitre.com/',
      },
    })
    expect(place.categories).toEqual(['wine_bar', 'bar'])
    expect(place.contact).toMatchObject({ phone: '+598 2418 5404', instagram: 'oriundo.uy', website: null, reservationUrl: 'https://oriundo.meitre.com/' })
    expect(place.reservations).toBe('accepts')
  })

  it('mantiene horarios y highlights aislados al extraer Namasté, Culto Café y Oriundo en secuencia', async () => {
    const fixtures = {
      'Namasté': {
        highlights: [{ es: 'sorrentinos', en: 'sorrentinos' }],
        hoursRaw: 'Tue-Sun 12:00-15:30 y 19:00-00:30',
        blocks: [
          { days: [0, 2, 3, 4, 5, 6], opens: '12:00', closes: '15:30' },
          { days: [0, 2, 3, 4, 5, 6], opens: '19:00', closes: '00:30' },
        ],
      },
      'Culto Café': {
        highlights: [{ es: 'crepe de cacao', en: 'cocoa crepe' }],
        hoursRaw: 'Mon 09:00-18:00',
        blocks: [{ days: [1], opens: '09:00', closes: '18:00' }],
      },
      Oriundo: {
        highlights: [{ es: 'tartín de temporada', en: 'seasonal tartin' }],
        hoursRaw: 'Fri-Sat 19:00-01:00',
        blocks: [{ days: [5, 6], opens: '19:00', closes: '01:00' }],
      },
    } as const
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: {
        getDetails: async (placeId) => {
          const name = placeId.replace('-place', '') as keyof typeof fixtures
          return { ...googleDetails, anchor: { ...googleDetails.anchor, name } }
        },
      },
      exa: {
        configured: true,
        searchPlace: async (name) => {
          const fixture = fixtures[name as keyof typeof fixtures]
          const response = exaResponse()
          return {
            ...response,
            output: {
              content: {
                ...response.output.content,
                description: fixture.highlights.map((highlight) => highlight.es).join('. '),
                open_hours_raw: fixture.hoursRaw,
              },
              grounding: {},
            },
          }
        },
      },
      generate: async (generatedTarget) => {
        const fixture = fixtures[generatedTarget.name as keyof typeof fixtures]
        return {
          ...emptyExtraction,
          facts: [{ id: 'F1', text: `abre ${fixture.hoursRaw}`, sourceId: 'S1', kind: 'hours' as const, proposedTag: null }],
          highlights: fixture.highlights.map((highlight) => ({ ...highlight, facts: ['F1'] })),
          hours: { raw: fixture.hoursRaw, display: null, blocks: fixture.blocks.map((block) => ({ ...block, days: [...block.days] })) },
          support: [{ field: 'hours', facts: ['F1'] }],
        }
      },
    })

    for (const name of ['Namasté', 'Culto Café', 'Oriundo'] as const) {
      const response = await service.extract(`${name}-place`, { seedCategories: ['restaurant'] })
      expect(response).toMatchObject({ status: 'ok', place: { highlights: fixtures[name].highlights } })
      expect(response.place?.hours.slots).toHaveLength(name === 'Namasté' ? 12 : name === 'Culto Café' ? 1 : 2)
    }
  })

  it('mantiene Oriundo estable en tres extracciones seguidas, sin cache', async () => {
    let runs = 0
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({
        ...googleDetails,
        anchor: { ...googleDetails.anchor, name: 'Oriundo' },
        websiteUri: 'https://oriundo.meitre.com/',
        phoneNumber: null,
      }) },
      exa: { configured: true, searchPlace: async () => ({
        ...exaResponse(),
        query: 'Oriundo, Montevideo, Uruguay',
        output: { content: { ...exaResponse().output.content, contact_info: 'Reservas: https://oriundo.meitre.com/ · Instagram: @magnolio.uy · Correo: @oriundo.uy · wine bar' }, grounding: {} },
      }) },
      generate: async () => {
        runs += 1
        return {
          ...emptyExtraction,
          facts: [{ id: 'F1', text: 'es un wine bar', sourceId: 'S1', kind: 'other' as const, proposedTag: null }],
          tags: runs % 2 ? [{ group: 'categories' as const, id: 'wine_bar', facts: ['F1'] }] : [],
          contact: { ...extraction.contact, instagram: 'magnolio.uy', reservationUrl: null },
          support: [],
        }
      },
    })

    const responses = []
    for (let index = 0; index < 3; index += 1) {
      responses.push(await service.extract('oriundo-place', { seedCategories: ['bar'] }))
    }
    for (const response of responses) {
      expect(response).toMatchObject({
        status: 'ok',
        place: { categories: expect.arrayContaining(['bar']), contact: { instagram: 'oriundo.uy', reservationUrl: 'https://oriundo.meitre.com/' } },
      })
    }
    expect(runs).toBe(3)
  })

  it('pide facts primero y no trae ejemplos de lugares ni platos reales en el prompt', () => {
    expect(SYSTEM_PROMPT.indexOf('PASO 1 — facts')).toBeLessThan(SYSTEM_PROMPT.indexOf('PASO 2'))
    expect(SYSTEM_PROMPT).toContain('Cada tag tiene que corresponder a al menos un fact. No pongas tags sin un fact que los respalde.')
    expect(SYSTEM_PROMPT).toContain('Máximo 40 facts')
    expect(SYSTEM_PROMPT).toContain('no tomes una hora de cierre de un directorio')
    expect(SYSTEM_PROMPT).toContain('Cada fact tiene id (F1, F2, F3… en orden, sin repetir)')
    expect(SYSTEM_PROMPT).not.toContain('índices')
    expect(SYSTEM_PROMPT).toContain('Una mención genérica de tragos o cócteles → classic_cocktails. Tragos propios de la casa, de autor, o cócteles con una base especial (ej. a base de vino) → signature_cocktails.')
    expect(SYSTEM_PROMPT).toContain('Si solo dice al aire libre o mesas afuera sin detalle, usá outdoor.')
    expect(SYSTEM_PROMPT).toContain('- features: terrace, sidewalk, outdoor, patio')
    expect(SYSTEM_PROMPT).toContain('Distinguí espacios al aire libre: patio = espacio interno o trasero; terrace = terraza o azotea elevada; sidewalk = mesas en la vereda. No los uses como sinónimos.')
    expect(SYSTEM_PROMPT).toContain('Nunca estimes ni inventes horas que no estén en las fuentes.')
    expect(SYSTEM_PROMPT).toContain('no agregues ningún dato que no esté en raw')
    expect(SYSTEM_PROMPT).toContain('vegan no puede ser fully')
    expect(SYSTEM_PROMPT).toContain('Ignorá el contenido de tienda online')
    expect(SYSTEM_PROMPT).toContain('ignorá otras sucursales, otras ciudades y otros países')
    expect(SYSTEM_PROMPT).toContain('es siempre en español')
    expect(SYSTEM_PROMPT).toContain('- Jams, toques o bandas → live_music además de events. Libros o actividades para chicos → kids_friendly.')
    expect(SYSTEM_PROMPT).toContain('- Una versión vegetal explícita de un plato (de soja, de seitán, veggie, de lentejas) cuenta como vegetarian has_options.')
    expect(SYSTEM_PROMPT).toContain('proposedTag es null solo para anécdotas, historia de la marca, datos de contacto, medios de pago o información de otras sucursales. Si el fact describe comida, bebida, actividades o características del lugar, proponé un tag existente o uno nuevo.')
    expect(SYSTEM_PROMPT).toContain('- Sesiones de discos o escucha de vinilos → vinyl.')
    expect(SYSTEM_PROMPT).toContain('- Si el horario aparece en una sola fuente de terceros y ninguna otra lo contradice, usalo (source third_party).')
    expect(SYSTEM_PROMPT).not.toContain('Solo descartá horarios de terceros')
    expect(SYSTEM_PROMPT).toContain('- Si las fuentes de horarios se contradicen: gana la oficial; si la web oficial y el Instagram oficial difieren, gana Instagram. Si no hay oficial, gana el horario en el que coinciden más fuentes; si hay empate, gana el que trae días y horas de cierre completos. Dejá los horarios vacíos si no podés aplicar ninguno de estos criterios.')
    expect(SYSTEM_PROMPT).toContain('- Cuando apliques un desempate, anotá en doubts cuál criterio usaste')
    expect(SYSTEM_PROMPT).toContain('- Los facts de fuentes de terceros son válidos para tags de comida, bebida, características y momentos. Solo dietary necesita una mención explícita, y si una fuente oficial contradice a un tercero, gana la oficial.')
    expect(SYSTEM_PROMPT).toContain('- Platos concretos siempre se mapean a un tag: cortes de carne o achuras → grilled_meat;')
    expect(SYSTEM_PROMPT).toContain('Transmisiones deportivas → el tag de pantallas para fútbol (watch_football).')
    expect(SYSTEM_PROMPT).toContain('- Platos y bebidas concretos nunca van con proposedTag null: mapealos al tag más cercano (tapas o platos pequeños → tapas, y además picada si mencionan tablas, fiambres o quesos para compartir; postres dulces → desserts; jugos o licuados → smoothies; yogur, tostadas o similares → breakfast).')
    expect(SYSTEM_PROMPT).toMatch(/- foods: .*picada, tapas/)
    expect(SYSTEM_PROMPT).toMatch(/- goodFor: .*lgbtq_friendly/)
    expect(SYSTEM_PROMPT).toMatch(/- features: .*shop/)
    expect(SYSTEM_PROMPT).toMatch(/- features: .*events, books, dancing/)
    expect(HOURS_RETRY_PROMPT).toContain('Solo usá horarios que correspondan a la sucursal de esta dirección. Si la fuente lista varias sucursales, elegí la que coincide con la dirección. Si no podés confirmar la sucursal, devolvé vacío.')
    expect(SYSTEM_PROMPT).toContain('- doubts: anotá en doubts lo que no supiste resolver (máx. 5). No inventes dudas.')
    expect(SYSTEM_PROMPT).toContain('- Si las fuentes dicen que el local está dentro de otro lugar (shopping, mercado, galería, hotel, museo, polo gastronómico), completá locatedIn con el nombre de ese lugar. Si no lo dicen claramente, null. No lo deduzcas solo de la dirección.')
    expect(SYSTEM_PROMPT).toContain('- Si completás locatedIn, citá en support los facts que lo dicen, con field locatedIn.')
    expect(SYSTEM_PROMPT).toContain('- Si una fuente dice que solo se paga en efectivo, usá cash_only.')
    expect(SYSTEM_PROMPT).toContain('- Sillas altas, menú infantil, juegos o espacio para chicos → kids_friendly.')
    for (const example of ['Oriundo', 'Culto', 'Namasté', 'Palenque', 'Berracos', 'Oviedo', 'Galician', 'Feira', 'Padrón', 'polenta', 'canilla', ['can', 'elones'].join('')]) {
      expect(SYSTEM_PROMPT.toLowerCase()).not.toContain(example.toLowerCase())
    }
  })

  it('valida los bloques de horario y descarta los inválidos', () => {
    expect(slotsFromBlocks([
      { days: [2, 3], opens: '12:00', closes: '15:30' },
      { days: [2], opens: '12:00', closes: '15:30' },
      { days: [6], opens: '9:00', closes: '24:00' },
      { days: [0, 7], opens: '10:00', closes: '14:00' },
      { days: [], opens: '10:00', closes: '14:00' },
      { days: [1], opens: '', closes: '14:00' },
      { days: [1], opens: '10:00', closes: '2 AM' },
      { days: [5], opens: '18:00', closes: null },
    ])).toEqual([
      { day: 2, opens: '12:00', closes: '15:30' },
      { day: 3, opens: '12:00', closes: '15:30' },
      { day: 5, opens: '18:00', closes: null },
      { day: 6, opens: '09:00', closes: '00:00' },
    ])
  })

  it('calcula status, display y source de los horarios desde los bloques del modelo', () => {
    const official = { id: 'S1', kind: 'instagram' as const, trust: 'official' as const, url: 'https://www.instagram.com/local/', text: 'Abrimos todos los días a partir de 18hs' }
    const exa = { id: 'S2', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Abre de martes a domingo' }
    const withHours = (hours: PlaceExtraction['hours'], sourceId: string, cite = true) => postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'abre todos los días desde las 18', sourceId, kind: 'hours', proposedTag: null }],
      hours,
      support: cite ? [{ field: 'hours.blocks.0', facts: ['F1'] }] : [],
    }, { sources: [official, exa] })

    const openEnded = withHours({
      raw: 'todos los días a partir de 18hs',
      display: { es: 'Todos los días de 18:00 a 02:00', en: 'Every day 6 PM–2 AM' },
      blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: '18:00', closes: null }],
    }, 'S1')
    expect(openEnded.hours).toEqual({
      raw: 'todos los días a partir de 18hs',
      slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opens: '18:00', closes: null })),
      display: { es: 'Todos los días desde las 18:00', en: 'Every day from 18:00' },
      status: 'partial',
      source: 'official',
      missingReason: null,
    })

    const exact = withHours({ raw: 'Mar a dom 12 a 15:30', display: null, blocks: [{ days: [2, 3, 4, 5, 6, 0], opens: '12:00', closes: '15:30' }] }, 'S2')
    expect(exact.hours).toMatchObject({ status: 'exact', source: 'third_party', display: { es: 'Martes a domingo: 12:00–15:30', en: 'Tuesday to Sunday: 12:00–15:30' } })

    const vague = withHours({ raw: 'Abrimos de noche', display: { es: 'De noche', en: 'At night' }, blocks: [] }, 'S1')
    expect(vague.hours).toEqual({ raw: 'Abrimos de noche', slots: [], display: { es: 'De noche', en: 'At night' }, status: 'vague', source: 'official', missingReason: 'no_data' })

    const unsupported = withHours({ raw: 'Lunes 9 a 18', display: null, blocks: [{ days: [1], opens: '09:00', closes: '18:00' }] }, 'S1', false)
    expect(unsupported.hours).toEqual({ raw: null, slots: [], display: null, status: 'none', source: null, missingReason: 'no_data' })
  })

  it('conserva sólo los datos que citan un fact válido', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: 'Pizzas a la leña y DJ los viernes' }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'hace pizzas a la leña', sourceId: 'S1', kind: 'food', proposedTag: null },
        { id: 'F2', text: 'pone DJ los viernes', sourceId: 'S1', kind: 'feature', proposedTag: null },
        { id: 'F3', text: 'acepta reservas', sourceId: 'S9', kind: 'reservations', proposedTag: null },
      ],
      tags: [
        { group: 'categories', id: 'pizzeria', facts: ['F1'] }, { group: 'categories', id: 'bar', facts: [] },
        { group: 'foods', id: 'pizza', facts: ['F1'] }, { group: 'foods', id: 'pasta', facts: [] }, { group: 'foods', id: 'id_inventado', facts: ['F1'] },
        { group: 'foods', id: 'constructor', facts: ['F1'] },
        { group: 'features', id: 'dj', facts: ['F2', 'F100'] }, { group: 'features', id: 'pizza', facts: ['F1'] },
        { group: 'goodFor', id: 'work', facts: [] },
      ],
      dietary: { vegan: 'has_options', vegetarian: 'unknown', glutenFree: 'unknown' },
      price: 'high',
      reservations: 'accepts',
      contact: { phone: '2915 0000', whatsapp: null, instagram: null, website: 'https://local.example/', menuUrl: null, reservationUrl: null },
      support: [
        { field: 'reservations', facts: ['F3'] },
        { field: 'contact.website', facts: ['F1'] },
      ],
    }, { sources: [source] })

    expect(place.categories).toEqual(['pizzeria', 'restaurant'])
    expect(place.tags).toEqual(expect.arrayContaining(['pizza', 'dj']))
    expect(place.tags).not.toContain('pasta')
    expect(place.tags).not.toContain('work')
    expect(place.dietary.vegan).toBe('unknown')
    expect(place.price).toBe('unknown')
    expect(place.reservations).toBe('unknown')
    expect(place.contact).toMatchObject({ phone: null, website: 'https://local.example/' })
  })

  it('mueve la evidencia de un website de reservas a reservationUrl', () => {
    expect(classifyContact({ phone: null, whatsapp: null, instagram: null, website: 'https://local.meitre.com/', menuUrl: null, reservationUrl: null }))
      .toMatchObject({ website: null, reservationUrl: 'https://local.meitre.com/' })
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'reserva por Meitre', sourceId: 'S1', kind: 'reservations', proposedTag: null }],
      contact: { phone: null, whatsapp: null, instagram: null, website: 'https://local.meitre.com/', menuUrl: null, reservationUrl: null },
      support: [{ field: 'contact.website', facts: ['F1'] }],
    }, { sources: [{ id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/', text: 'Reservas por Meitre' }] })
    expect(place.contact).toMatchObject({ website: null, reservationUrl: 'https://local.meitre.com/' })
    expect(place.reservations).toBe('accepts')
  })

  it('devuelve placeFacts con id y lo que respalda cada uno, hasta 40, y sin usarlos para la búsqueda', () => {
    const sources = [
      { id: 'S1', kind: 'instagram' as const, trust: 'official' as const, url: 'https://www.instagram.com/local/', text: 'DJ los viernes' },
      { id: 'S2', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Resumen' },
    ]
    const facts = Array.from({ length: 45 }, (_, index) => ({ id: `F${index + 1}`, text: `fact ${index} FACT_NO_EN_BUSQUEDA`, sourceId: index === 1 ? 'S2' : 'S1', kind: 'other' as const, proposedTag: null }))
    facts[2] = { id: 'F3', text: 'fact inválido', sourceId: 'S7', kind: 'other', proposedTag: null }
    facts[3] = { id: 'F1', text: 'fact con id repetido', sourceId: 'S1', kind: 'other', proposedTag: null }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts,
      tags: [{ group: 'features', id: 'dj', facts: ['F1', 'F2', 'F99'] }, { group: 'categories', id: 'bar', facts: ['F2'] }],
    }, { sources })

    // 40 facts como máximo, menos el de fuente inexistente y el de id repetido.
    expect(place.placeFacts).toHaveLength(38)
    expect(place.placeFacts[0]).toEqual({
      id: 'F1', text: 'fact 0 FACT_NO_EN_BUSQUEDA', kind: 'other', sourceId: 'S1', sourceUrl: 'https://www.instagram.com/local/', trust: 'official', supports: ['features.dj'],
    })
    expect(place.placeFacts[1]).toMatchObject({ id: 'F2', sourceId: 'S2', trust: 'third_party', supports: ['features.dj', 'categories.bar'] })
    expect(place.placeFacts.some((fact) => fact.text === 'fact inválido' || fact.text === 'fact con id repetido')).toBe(false)
    expect(place.embeddingText).not.toContain('FACT_NO_EN_BUSQUEDA')
    expect(place.keywordText).not.toContain('FACT_NO_EN_BUSQUEDA')
  })

  it('guarda locatedIn citando su fact y lo suma a los textos de búsqueda', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'third_party' as const, url: 'https://guia.example/', text: 'Parrilla en el Mercado del Puerto.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'Está en el Mercado del Puerto', sourceId: 'S1', kind: 'other', proposedTag: null }],
      locatedIn: '  Mercado del Puerto ',
      support: [{ field: 'locatedIn', facts: ['F1'] }],
    }
    const inside = postProcess(target, data, { sources: [source] })
    expect(inside.locatedIn).toBe('Mercado del Puerto')
    expect(inside.embeddingText).toContain('Dentro de Mercado del Puerto')
    expect(inside.keywordText).toContain('Dentro de Mercado del Puerto')
    expect(inside.placeFacts[0].supports).toEqual(['locatedIn'])
    expect(reviewExtraction(inside, data).unmappedFacts).toEqual([])

    // Sin un fact válido que lo respalde, o con nombre vacío, se descarta.
    const uncited = postProcess(target, { ...data, support: [{ field: 'locatedIn', facts: ['F9'] }] }, { sources: [source] })
    expect(uncited.locatedIn).toBeNull()
    expect(uncited.embeddingText).not.toContain('Dentro de')
    expect(reviewExtraction(uncited, data).unmappedFacts.map((item) => item.id)).toEqual(['F1'])
    const blank = postProcess(target, { ...data, locatedIn: '   ' }, { sources: [source] })
    expect(blank.locatedIn).toBeNull()
  })

  it('aplica las reglas que no dependen de palabras: categorías, horarios y dietary', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: 'Fuente' }
    const grill = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'abre de 12 a 03', sourceId: 'S1', kind: 'hours', proposedTag: null }],
      tags: [{ group: 'moments', id: 'late_night', facts: ['F1'] }],
      hours: { raw: 'Viernes de 12 a 03', display: null, blocks: [{ days: [5], opens: '12:00', closes: '03:00' }] },
      support: [{ field: 'hours', facts: ['F1'] }],
    }, { sources: [source], seedCategories: ['grill'] })
    expect(grill.categories).toEqual(['grill', 'restaurant'])
    expect(grill.tags).toEqual(expect.arrayContaining(['grilled_meat', 'uruguayan', 'lunch', 'dinner', 'late_night']))

    const modelLateNight = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'abre hasta tarde', sourceId: 'S1', kind: 'hours', proposedTag: null }],
      tags: [{ group: 'moments', id: 'late_night', facts: ['F1'] }],
      hours: { raw: 'Viernes de 19 a 01', display: null, blocks: [{ days: [5], opens: '19:00', closes: '01:00' }] },
      support: [{ field: 'hours', facts: ['F1'] }],
    }, { sources: [source], seedCategories: ['bar'] })
    expect(modelLateNight.tags).not.toContain('late_night')
    expect(modelLateNight.tags).toContain('drinks')

    const cafe = postProcess(target, emptyExtraction, { sources: [source], seedCategories: ['cafe'] })
    expect(cafe.tags).toEqual(expect.arrayContaining(['breakfast', 'afternoon_snack']))

    const vegetarianGrill = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'todo el menú es vegano', sourceId: 'S1', kind: 'dietary', proposedTag: null }],
      dietary: { vegan: 'fully', vegetarian: 'unknown', glutenFree: 'unknown' },
      support: [{ field: 'dietary.vegan', facts: ['F1'] }],
    }, { sources: [source], seedCategories: ['grill'] })
    expect(vegetarianGrill.dietary).toMatchObject({ vegan: 'fully', vegetarian: 'fully' })
    expect(vegetarianGrill.tags).not.toContain('grilled_meat')
  })

  it('descarta highlights sin fact válido o que no aparecen en las fuentes, y deja como máximo ocho', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: Array.from({ length: 10 }, (_, index) => `plato ${index}`).join('. ') }
    const place = postProcess(target, {
      ...emptyExtraction,
      facts: [{ id: 'F1', text: 'la carta tiene platos', sourceId: 'S1', kind: 'food', proposedTag: null }],
      highlights: [
        { es: 'plato inventado', en: 'made up dish', facts: ['F1'] },
        { es: 'plato 9', en: 'dish 9', facts: [] },
        { es: 'plato 8', en: 'dish 8', facts: ['F7'] },
        ...Array.from({ length: 10 }, (_, index) => ({ es: `plato ${index}`, en: `dish ${index}`, facts: ['F1'] })),
      ],
    }, { sources: [source] })
    expect(place.highlights).toHaveLength(8)
    expect(place.highlights[0]).toEqual({ es: 'plato 0', en: 'dish 0' })
  })

  it('revisa facts sin mapear, dudas del modelo y anomalías de horarios, bebidas y contacto', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://bar.example/', text: 'Abrimos todos los días desde las 18. Probá el flat white. Mesa de ping pong.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Abre todos los días desde las 18:00', sourceId: 'S1', kind: 'hours', proposedTag: null },
        { id: 'F2', text: 'Sirve flat white', sourceId: 'S1', kind: 'drink', proposedTag: null },
        // proposedTag: un id nuevo en snake_case se conserva; uno inválido cuenta como null.
        { id: 'F3', text: 'Mesa de ping pong', sourceId: 'S1', kind: 'feature', proposedTag: 'ping_pong' },
        { id: 'F4', text: 'Tiene un Lemon con la receta de la abuela', sourceId: 'S1', kind: 'drink', proposedTag: 'Receta Abuela!' },
      ],
      // Un id que no existe en tags.ts no cuenta como mapeo: F3 tiene que aparecer en el reporte.
      tags: [{ group: 'features', id: 'ping_pong', facts: ['F3'] }],
      highlights: [{ es: 'flat white', en: 'flat white', facts: ['F2'] }],
      hours: { raw: 'Todos los días desde las 18', display: null, blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: '18:00', closes: null }] },
      support: [{ field: 'hours', facts: ['F1'] }],
      doubts: ['¿Es bar o boliche?', '  ', '¿Es bar o boliche?', 'd2', 'd3', 'd4', 'd5', 'd6'],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['bar'] })
    const review = reviewExtraction(place, data)

    expect(review.unmappedFacts).toEqual([
      { id: 'F3', text: 'Mesa de ping pong', proposedTag: 'ping_pong' },
      { id: 'F4', text: 'Tiene un Lemon con la receta de la abuela', proposedTag: null },
    ])
    expect(review.doubts).toEqual(['¿Es bar o boliche?', 'd2', 'd3', 'd4', 'd5'])
    expect(review.anomalies.map((anomaly) => anomaly.type)).toEqual(['hours_no_close', 'bar_without_drinks', 'no_contact'])
    expect(review.anomalies[0].detail).toBe('dom desde 18:00, lun desde 18:00, mar desde 18:00, mié desde 18:00, jue desde 18:00, vie desde 18:00, sáb desde 18:00')
  })

  it('aplica los proposedTag que existen en tags.ts, también categorías, salvo horarios y dietary', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://bar.example/', text: 'Chivito vegano. Talleres. Abrimos de noche.' }
    const fact = (id: string, text: string, proposedTag: string | null) => ({ id, text, sourceId: 'S1', kind: 'other' as const, proposedTag })
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        fact('F1', 'Tiene chivito vegano', 'chivito'),
        fact('F2', 'Cursos y talleres de barismo', 'events'),
        fact('F3', 'Hacen talleres de cerámica', 'events'),
        fact('F4', 'Abre pasada la medianoche', 'late_night'),
        fact('F5', 'Sirve almuerzos', 'lunch'),
        fact('F6', 'Todo es vegano', 'vegan'),
        fact('F7', 'Es un bar', 'bar'),
        fact('F8', 'Alfajores helados', 'alfajores'),
        fact('F9', 'Tiene wifi', 'wifi'),
      ],
      tags: [{ group: 'features', id: 'wifi', facts: ['F9'] }],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['cafe'] })

    expect(place.tags).toEqual(expect.arrayContaining(['chivito', 'events', 'wifi']))
    expect(place.tags).not.toContain('late_night')
    expect(place.tags).not.toContain('lunch')
    expect(place.categories).toEqual(expect.arrayContaining(['cafe', 'bar']))
    expect(place.dietary.vegan).toBe('unknown')
    // Cada fact que propone el tag queda citado por él; el tag aparece una sola vez.
    expect(place.tags.filter((id) => id === 'events')).toHaveLength(1)
    expect(place.placeFacts.find((item) => item.id === 'F1')?.supports).toEqual(['foods.chivito'])
    expect(place.placeFacts.find((item) => item.id === 'F2')?.supports).toEqual(['features.events'])
    expect(place.placeFacts.find((item) => item.id === 'F3')?.supports).toEqual(['features.events'])
    expect(place.placeFacts.find((item) => item.id === 'F9')?.supports).toEqual(['features.wifi'])
    expect(place.placeFacts.find((item) => item.id === 'F7')?.supports).toEqual(['categories.bar'])
    expect(reviewExtraction(place, data).unmappedFacts.map((item) => [item.id, item.proposedTag])).toEqual([
      ['F4', 'late_night'], ['F5', 'lunch'], ['F6', 'vegan'], ['F8', 'alfajores'],
    ])
  })

  it('suma a un tag que ya existe el fact que lo propone, y ese fact deja de ser unmapped', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://cafe.example/', text: 'Café de especialidad. Blend Black Magic.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Sirve café de especialidad', sourceId: 'S1', kind: 'drink', proposedTag: null },
        { id: 'F2', text: 'Hay un blend Black Magic y cafés de origen', sourceId: 'S1', kind: 'drink', proposedTag: 'specialty_coffee' },
      ],
      tags: [{ group: 'drinks', id: 'specialty_coffee', facts: ['F1'] }],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['cafe'] })

    expect(place.tags.filter((id) => id === 'specialty_coffee')).toHaveLength(1)
    expect(place.placeFacts.find((item) => item.id === 'F2')?.supports).toEqual(['drinks.specialty_coffee'])
    expect(reviewExtraction(place, data).unmappedFacts).toEqual([])
  })

  it('suma a una categoría que ya está el fact que la propone', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://parrilla.example/', text: 'Parrilla. Asado a leña.' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Es una parrilla', sourceId: 'S1', kind: 'other', proposedTag: null },
        { id: 'F2', text: 'Asan a leña en el salón', sourceId: 'S1', kind: 'food', proposedTag: 'grill' },
      ],
      tags: [{ group: 'categories', id: 'grill', facts: ['F1'] }],
    }
    const place = postProcess(target, data, { sources: [source] })

    expect(place.categories.filter((id) => id === 'grill')).toHaveLength(1)
    expect(place.placeFacts.find((item) => item.id === 'F2')?.supports).toEqual(['categories.grill'])
    expect(reviewExtraction(place, data).unmappedFacts).toEqual([])
  })

  it('marca horario vago, restaurante sin comidas y dietary fully', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://resto.example/', text: 'Restaurante 100% vegano. instagram.com/resto' }
    const data: PlaceExtraction = {
      ...emptyExtraction,
      facts: [
        { id: 'F1', text: 'Es 100% vegano', sourceId: 'S1', kind: 'dietary', proposedTag: null },
        { id: 'F2', text: 'Instagram @resto', sourceId: 'S1', kind: 'contact', proposedTag: null },
      ],
      dietary: { vegan: 'fully', vegetarian: 'unknown', glutenFree: 'unknown' },
      contact: { ...emptyExtraction.contact, instagram: 'resto', website: null, phone: null },
      support: [{ field: 'dietary.vegan', facts: ['F1'] }, { field: 'contact.instagram', facts: ['F2'] }],
    }
    const place = postProcess(target, data, { sources: [source], seedCategories: ['restaurant'] })
    const types = reviewExtraction(place, data).anomalies.map((anomaly) => anomaly.type)

    expect(types).toEqual(['hours_vague', 'restaurant_without_food', 'dietary_fully'])
    expect(reviewExtraction(place, data).anomalies[0].detail).toBe('none')
    expect(reviewExtraction(place, data).unmappedFacts).toEqual([])
  })

  it('lee el modelo y el razonamiento del entorno y arma las opciones de cada proveedor', () => {
    expect(extractionModelConfig({})).toEqual({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })
    expect(extractionModelConfig({ EXTRACTION_MODEL: 'openai/gpt-5-mini', EXTRACTION_REASONING: 'low' }))
      .toEqual({ model: 'openai/gpt-5-mini', reasoning: 'low' })
    expect(extractionModelConfig({ EXTRACTION_MODEL: 'anthropic/claude-sonnet-5.5', EXTRACTION_REASONING: 'medium' }))
      .toEqual({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })
    expect(extractionModelConfig({ EXTRACTION_REASONING: 'extremo' }).reasoning).toBe('medium')
    expect(providerOptionsFor({ model: 'openai/gpt-5-mini', reasoning: 'low' })).toEqual({ openai: { reasoningEffort: 'low' } })
    expect(providerOptionsFor({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })).toEqual({ anthropic: { effort: 'medium', structuredOutputMode: 'outputFormat' } })
    expect(providerOptionsFor({ model: 'otro/modelo', reasoning: 'high' })).toEqual({})
  })

  describe('segunda búsqueda de horarios', () => {
    const sonnet = { model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' as const }
    const branchPage = { title: 'Sucursales', url: 'https://cadena.example/sucursales', highlights: ['Ituzaingó 1447: todos los días de 12 a 23'], text: 'Ituzaingó 1447: todos los días de 12 a 23. Pocitos: 10 a 22.' }
    type ServiceConfig = ConstructorParameters<typeof PlaceExtractionService>[0]
    const serviceWith = (searchText: NonNullable<ServiceConfig['exa']>['searchText'], generateHours: ServiceConfig['generateHours'], extracted = emptyExtraction) =>
      new PlaceExtractionService({
        apiKey: 'test-key',
        details: { getDetails: async () => googleDetails },
        exa: { configured: true, searchPlace: async () => exaResponse(), searchText },
        generate: async () => extracted,
        generateHours,
        model: sonnet,
        hoursModel: hoursModelConfig({}),
      })

    it('recupera el horario de la sucursal con una búsqueda de highlights y un llamado corto con HOURS_MODEL, y suma su costo', async () => {
      const searchText = vi.fn(async (query: string) => ({ query, results: [branchPage], requestId: 'r' }))
      const hoursCalls: { sources: Source[]; model: string; reasoning: string; address: string }[] = []
      const service = serviceWith(searchText, async (hoursTarget, sources, config) => {
        hoursCalls.push({ sources, model: config.model, reasoning: config.reasoning, address: hoursTarget.address })
        return {
          data: {
            facts: [{ id: 'F9', text: 'La sucursal de Ituzaingó abre todos los días de 12 a 23', sourceId: sources[0].id }],
            raw: 'todos los días de 12 a 23',
            blocks: [{ days: [0, 1, 2, 3, 4, 5, 6], opens: '12:00', closes: '23:00' }],
            otherBranchHours: true,
          },
          inputTokens: 1000, cachedInputTokens: 0, outputTokens: 100, gatewayCostUsd: null,
        }
      })

      const response = await service.extract('place-1', { seedCategories: ['restaurant'] })
      if (response.status !== 'ok') throw new Error('sin fuentes')

      expect(searchText.mock.calls.map(([query]) => query)).toEqual([`${googleDetails.anchor.name} ${googleDetails.anchor.address} horario`])
      // Las fuentes nuevas se numeran después de las del lugar.
      expect(hoursCalls).toHaveLength(1)
      expect(hoursCalls[0].sources.map((source) => source.url)).toEqual(['https://cadena.example/sucursales'])
      expect(hoursCalls[0].sources[0].id).not.toBe('S1')
      expect(hoursCalls[0]).toMatchObject({ model: 'openai/gpt-5-mini', reasoning: 'low' })
      expect(hoursCalls[0].address).toBe(googleDetails.anchor.address)
      expect(response.place.hours).toMatchObject({ status: 'exact', source: 'third_party', missingReason: null })
      expect(response.place.hours.slots).toHaveLength(7)
      // Las reglas que dependen de los horarios se vuelven a aplicar con el horario recuperado.
      expect(response.place.tags).toEqual(expect.arrayContaining(['lunch', 'dinner']))
      expect(response.place.placeFacts[0]).toMatchObject({ id: 'H1', kind: 'hours', supports: ['hours'], sourceUrl: 'https://cadena.example/sucursales' })
      // Exa: 1 búsqueda (0,007) + 1 página de highlights (0,001); gpt-5-mini: 1000 in (0,00025) + 100 out (0,0002).
      expect(response.review.hoursRetry).toEqual({ attempted: true, recovered: true, costUsd: 0.00845 })
      expect(response.performance.costUsd.providers.hoursRetry).toEqual({ model: 'openai/gpt-5-mini', inputTokens: 1000, outputTokens: 100, costUsd: 0.00045 })
      expect(response.performance.costUsd.providers.exa).toMatchObject({ requests: 2, highlightPages: 1 })
      expect(response.performance.costUsd.providers.llm.model).toBe(sonnet.model)
    })

    it('marca chain_branch_not_found si sólo hay horarios de otras sucursales, y no_data si no hay nada', async () => {
      const otherBranch = serviceWith(async (query) => ({ query, results: [branchPage], requestId: 'r' }), async () => ({
        facts: [], raw: null, blocks: [], otherBranchHours: true,
      }))
      const chain = await otherBranch.extract('place-1', { seedCategories: ['cafe'] })
      if (chain.status !== 'ok') throw new Error('sin fuentes')
      expect(chain.place.hours).toMatchObject({ status: 'none', missingReason: 'chain_branch_not_found' })
      expect(chain.review.hoursRetry).toMatchObject({ attempted: true, recovered: false })

      const generateHours = vi.fn()
      const empty = serviceWith(async (query) => ({ query, results: [], requestId: 'r' }), generateHours)
      const none = await empty.extract('place-1', { seedCategories: ['cafe'] })
      if (none.status !== 'ok') throw new Error('sin fuentes')
      expect(generateHours).not.toHaveBeenCalled()
      expect(none.place.hours.missingReason).toBe('no_data')
      expect(none.review.hoursRetry).toEqual({ attempted: true, recovered: false, costUsd: 0.007 })
    })

    it('descarta un horario recuperado cuya fuente no nombra la dirección del local', async () => {
      const otherMall = { title: 'Freddo Tres Cruces', url: 'https://shopping.example/freddo', highlights: ['Freddo Tres Cruces: D. a J. de 09:00 a 24:00'] }
      const service = serviceWith(async (query) => ({ query, results: [otherMall], requestId: 'r' }), async (_target, sources) => ({
        facts: [{ id: 'H1', text: 'Abre de 09:00 a 24:00', sourceId: sources[0].id }],
        raw: 'D. a J. de 09:00 a 24:00',
        blocks: [{ days: [0, 1, 2, 3, 4], opens: '09:00', closes: '00:00' }],
        otherBranchHours: false,
      }))
      const response = await service.extract('place-1', { seedCategories: ['cafe'] })
      if (response.status !== 'ok') throw new Error('sin fuentes')
      expect(response.place.hours).toMatchObject({ status: 'none', missingReason: 'no_data' })
      expect(response.review.hoursRetry).toMatchObject({ attempted: true, recovered: false })

      expect(mentionsAddress('Sucursal Gonzalo Ramírez 2051: 12 a 24', 'Av. Gonzalo Ramírez 2051, 11200 Montevideo')).toBe(true)
      expect(mentionsAddress('Freddo Tres Cruces, local 2051B', 'Av. Gonzalo Ramírez 2051, 11200 Montevideo')).toBe(false)
      expect(mentionsAddress('Rambla Rep. de México esquina', 'Rambla República de México, Montevideo')).toBe(false)
      expect(mentionsAddress('Rambla República de México, abre 10 a 20', 'Rambla República de México, Montevideo')).toBe(true)
    })

    it('no busca de nuevo si la extracción ya trae horario', async () => {
      const searchText = vi.fn()
      const service = serviceWith(searchText, vi.fn(), { ...extraction, support: [{ field: 'hours', facts: ['F1'] }] })
      const response = await service.extract('place-1', { seedCategories: ['cafe'] })
      if (response.status !== 'ok') throw new Error('sin fuentes')
      expect(searchText).not.toHaveBeenCalled()
      expect(response.place.hours.missingReason).toBeNull()
      expect(response.review.hoursRetry).toEqual({ attempted: false, recovered: false, costUsd: 0 })
      expect(response.performance.costUsd.providers.hoursRetry).toBeUndefined()
    })
  })

  it('lee HOURS_MODEL, marca el prompt de sistema para el cache y cobra la lectura y escritura del cache', () => {
    expect(hoursModelConfig({})).toEqual({ model: 'openai/gpt-5-mini', reasoning: 'low' })
    expect(hoursModelConfig({ HOURS_MODEL: 'anthropic/claude-sonnet-5.5' })).toEqual({ model: 'anthropic/claude-sonnet-5.5', reasoning: 'low' })

    const request = mainExtractionRequest(target, [], { model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })
    expect(request.system).toEqual({ role: 'system', content: SYSTEM_PROMPT, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } })
    expect(request.providerOptions).toEqual({ anthropic: { effort: 'medium', structuredOutputMode: 'outputFormat' } })

    // 10.000 de entrada: 2.000 sin cache (2/M), 5.000 leídos (0,1/M) y 3.000 escritos (2,5/M).
    const cost = llmUsageCost('anthropic/claude-sonnet-5.5', { inputTokens: 10_000, cachedInputTokens: 5_000, cacheWriteTokens: 3_000, outputTokens: 0, gatewayCostUsd: null })
    expect(cost.inputCost).toBeCloseTo(0.004 + 0.0005 + 0.0075, 10)
  })

  it('busca las fuentes una vez y las pasa iguales a dos configuraciones de modelo', async () => {
    const getDetails = vi.fn(async () => googleDetails)
    const searchPlace = vi.fn(async () => exaResponse('', [{ title: target.name, url: 'https://cafe.example/', highlights: ['Café de especialidad'] }]))
    const calls: { sources: Source[]; model: string; reasoning: string }[] = []
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails },
      exa: { configured: true, searchPlace },
      generate: async (_target, sources, config) => {
        calls.push({ sources, ...config })
        return { data: emptyExtraction, inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500, gatewayCostUsd: null }
      },
    })

    const collected = await service.collectSources('place-1', { seedCategories: ['cafe'] })
    const mini = await service.extractFrom(collected, { model: 'openai/gpt-5-mini', reasoning: 'low' })
    const sonnet = await service.extractFrom(collected, { model: 'anthropic/claude-sonnet-5.5', reasoning: 'medium' })

    expect(getDetails).toHaveBeenCalledOnce()
    expect(searchPlace).toHaveBeenCalledOnce()
    expect(calls.map((call) => [call.model, call.reasoning])).toEqual([['openai/gpt-5-mini', 'low'], ['anthropic/claude-sonnet-5.5', 'medium']])
    expect(calls[1].sources).toBe(calls[0].sources)
    expect(mini.model).toBe('openai/gpt-5-mini')
    expect(sonnet.performance.costUsd.providers.llm).toMatchObject({ model: 'anthropic/claude-sonnet-5.5', inputCostUsd: 0.002, outputCostUsd: 0.005 })
    expect(mini.performance.costUsd.providers.llm).toMatchObject({ inputCostUsd: 0.00025, outputCostUsd: 0.001 })
  })
})
