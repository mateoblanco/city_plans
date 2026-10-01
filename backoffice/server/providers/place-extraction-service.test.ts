import { describe, expect, it, vi } from 'vitest'
import {
  PlaceExtractionService,
  filterSources,
  classifyContact,
  classifySource,
  daysFromRange,
  deduplicateSourceText,
  parseExplicitHours,
  postProcess,
  resolveDeterministicContact,
  SYSTEM_PROMPT,
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
  categories: ['cafe'], moments: ['breakfast'], cuisines: [], foods: ['pastries'], drinks: ['specialty_coffee'], features: ['wifi'], goodFor: ['work'],
  dietary: { vegan: 'unknown', vegetarian: 'has_options', glutenFree: 'unknown' },
  price: 'moderate', reservations: 'unknown', outdoorSeating: 'yes',
  hours: { raw: 'Lunes 08:00 a 19:00', display: { es: 'Lunes, 08:00 a 19:00', en: 'Monday, 8 AM–7 PM' }, ranges: [{ days: 'Mon', opens: '08:00', closes: '19:00' }] },
  contact: { phone: '2915 0000', whatsapp: null, instagram: 'cafebrasilero', website: 'https://cafe.example/', menuUrl: null, reservationUrl: null },
  highlights: [{ es: 'flat white', en: 'flat white' }],
  description: { es: 'Un café histórico para hacer una pausa.', en: 'A historic café for a relaxed break.' },
  evidence: [{ field: 'moments.breakfast', sourceId: 'S1', quote: null }],
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
  it('incluye formatos de horarios y regla de espacios al aire libre en el prompt', () => {
    expect(SYSTEM_PROMPT).toContain('Every day, 12:00 PM - 01:00 AM')
    expect(SYSTEM_PROMPT).toContain('Mon-Fri 9:00-18:00')
    expect(SYSTEM_PROMPT).toContain('"Cerrado" o "Closed"')
    expect(SYSTEM_PROMPT).toContain('open_hours')
    expect(SYSTEM_PROMPT).toContain('hours.display')
    expect(SYSTEM_PROMPT).toContain('shared patio')
    expect(SYSTEM_PROMPT).toContain('outdoorSeating')
    expect(SYSTEM_PROMPT).toContain('highlights.es siempre en español')
    expect(SYSTEM_PROMPT).toContain('Galician pie” → “Pastel gallego')
    expect(SYSTEM_PROMPT).toContain('Feira octopus” → “Pulpo a la feira')
    expect(SYSTEM_PROMPT).toContain('Padrón peppers” → “Pimientos de Padrón')
    expect(SYSTEM_PROMPT).toContain('Ignorá contenido de tienda online: productos envasados, bolsas de café, suscripciones, insumos, merch, gift cards y sus precios. Solo te interesa lo que se consume en el local.')
    for (const example of ['Oriundo', 'Culto', 'polenta', 'vino de canilla', 'martín fierro']) {
      expect(SYSTEM_PROMPT.toLowerCase()).not.toContain(example.toLowerCase())
    }
    expect(SYSTEM_PROMPT).not.toContain(['can', 'elones'].join(''))
  })

  it('filtra fuentes bloqueadas y produce el borrador', () => {
    expect(filterSources([
      { id: 'S1', kind: 'web', url: 'https://cafe.example/', text: 'Café de especialidad' },
      { id: 'S2', kind: 'web', url: 'https://www.google.com/maps', text: 'No usar' },
    ])).toHaveLength(1)

    const place = postProcess(target, {
      ...extraction,
      evidence: [{ field: 'categories.cafe', sourceId: 'S1', quote: 'Café de especialidad' }],
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

    const result = await service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
    expect(result.status).toBe('ok')
    expect(generated).toBe(true)
    expect(sourceKinds).toEqual(['exa', 'exa'])
    expect(result.sourceAudit).toEqual({
      google: true, exa: true, instagram: false, instagramCandidates: [],
      instagramSelection: { handle: null, origin: null, candidates: [] },
    })
  })

  it('devuelve el costo estimado por proveedor y el total', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => ({ ...googleDetails, websiteUri: 'https://cafe.example/' }) },
      exa: { configured: true, searchPlace: async () => exaResponse('@cafebrasilero', [{ title: target.name, url: 'https://cafe.example/menu', highlights: ['Café Brasilero'] }]) },
      instagram: { configured: true, scrapeMany: async () => [{ url: 'https://www.instagram.com/cafebrasilero/', name: target.name, bio: 'Montevideo, Uruguay', links: [] }] },
      website: { configured: true, scrape: async () => ({ url: 'https://cafe.example/', title: target.name, description: '', content: 'Café de especialidad', instagramUrls: [] }) },
      transit: { findNearbyLines: async () => ({ status: 'success', lines: [] }) },
      generate: async () => ({ data: extraction, inputTokens: 10, outputTokens: 20 }),
      costRates: {
        googleDetailsRequestUsd: 1,
        exaSearchRequestUsd: 2,
        exaContentPageUsd: 3,
        instagramRunUsd: 4,
        scrapingRequestUsd: 5,
        transitRequestUsd: 6,
        llmInputTokenUsd: 0.01,
        llmOutputTokenUsd: 0.02,
      },
    })

    const result = await service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
    expect(result.performance.costUsd).toEqual({
      currency: 'USD',
      estimated: true,
      totalUsd: 21.5,
      providers: {
        google: { requests: 1, costUsd: 1 },
        exa: { requests: 1, contentPages: 1, costUsd: 5 },
        instagram: { requests: 1, costUsd: 4 },
        scraping: { requests: 1, costUsd: 5 },
        transit: { requests: 1, costUsd: 6 },
        llm: { inputTokens: 10, outputTokens: 20, inputCostUsd: 0.1, outputCostUsd: 0.4, costUsd: 0.5 },
      },
    })
  })

  it('solapa Google con Exa, luego buses con Apify y finalmente el LLM con buses', async () => {
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

    const resultPromise = service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
    expect(events).toEqual(['google', 'exa'])

    detailsRun.resolve(googleDetails)
    await vi.waitFor(() => expect(events).toContain('buses'))
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
    await vi.waitFor(() => expect(events).toContain('llm'))
    expect(events.at(-1)).toBe('llm')

    llmRun.resolve(extraction)
    transitRun.resolve({ status: 'success', lines: [] })
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

    const result = await service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
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

    const result = await service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
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

    const result = await service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
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

    const result = await service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
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

  it('rechaza un nombre que no coincide con Google', async () => {
    const service = new PlaceExtractionService({
      apiKey: 'test-key',
      details: { getDetails: async () => googleDetails },
      exa: { configured: false, searchPlace: async () => exaResponse() },
      generate: async () => extraction,
    })

    await expect(service.extract('place-1', { name: 'Otro restaurante', seedCategory: 'restaurant' })).rejects.toMatchObject({ kind: 'validation' })
  })

  it('reclasifica plataformas de reserva y remueve momentos sin evidencia', () => {
    expect(classifyContact({ ...extraction.contact, website: 'https://meitre.com/cafe', reservationUrl: null })).toMatchObject({
      website: null, reservationUrl: 'https://meitre.com/cafe',
    })
    const place = postProcess(target, {
      ...extraction,
      moments: ['breakfast', 'late_night'],
      evidence: [{ field: 'moments.breakfast', sourceId: 'S1', quote: null }],
    }, { sources: [{ id: 'S1', kind: 'directory', trust: 'third_party', url: 'https://directory.example/', text: 'Desayuno' }] })
    expect(place.moments).toEqual(expect.arrayContaining(['breakfast', 'afternoon_snack']))
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
        return { ...extraction, categories: [], moments: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [], hours: { raw: null, display: null, ranges: [] }, evidence: [] }
      },
    })
    await service.extract('place-1', { name: 'Café Brasilero', seedCategory: 'cafe' })
    expect(generatedSources).toEqual([
      expect.objectContaining({ id: 'S1', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/', exaDescription: 'SUMMARY_MUST_NOT_BE_A_SOURCE', exaKnowsBeforeYouGo: 'KNOWS_MUST_BE_PRESERVED' }),
      expect.objectContaining({ id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://cafebrasilero.uy/', text: 'Café histórico de Montevideo' }),
    ])
    expect(generatedSources[0].text).toContain('SUMMARY_MUST_NOT_BE_A_SOURCE')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"blockedDomains":["exa.ai"]'))
    log.mockRestore()
  })

  it('valida citas y elimina datos sin respaldo', () => {
    const place = postProcess(target, {
      ...extraction,
      categories: ['cafe'],
      features: ['wifi'],
      price: 'moderate',
      hours: { raw: 'Usually open 08:00 to 18:00', display: { es: 'Lunes, 08:00 a 18:00', en: 'Monday, 8 AM–6 PM' }, ranges: [{ days: 'Mon', opens: '08:00', closes: '18:00' }] },
      contact: { ...extraction.contact, phone: '2915 0000', instagram: null },
      evidence: [
        { field: 'categories.cafe', sourceId: 'S1', quote: 'cafe de especialidad' },
        { field: 'features.wifi', sourceId: 'S2', quote: 'WiFi disponible' },
        { field: 'price', sourceId: 'S1', quote: 'precio inexistente' },
        { field: 'hours.ranges.0', sourceId: 'S1', quote: 'Usually open 08:00' },
      ],
    }, { sources: [
      { id: 'S1', kind: 'web', trust: 'official', url: 'https://cafe.example/', text: 'Café   de especialidad. Usually open 08:00 to 18:00.' },
      { id: 'S2', kind: 'directory', trust: 'third_party', url: 'https://opina.example/', text: 'WiFi disponible' },
    ] })
    expect(place.categories).toEqual(['cafe'])
    expect(place.features).toEqual(['wifi'])
    expect(place.price).toBe('unknown')
    expect(place.hours).toEqual({ raw: null, display: null, slots: [], status: 'none', source: null })
    expect(place.contact.phone).toBeNull()
  })

  it('permite que reservas verifique sólo contact.reservationUrl e infiere el handle validado', () => {
    const place = postProcess(target, {
      ...extraction,
      categories: [], moments: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [], hours: { raw: null, display: null, ranges: [] },
      reservations: 'accepts',
      contact: { phone: null, whatsapp: null, instagram: null, website: null, menuUrl: null, reservationUrl: 'https://meitre.com/cafe' },
      evidence: [
        { field: 'reservations', sourceId: 'S1', quote: 'Reservas disponibles' },
        { field: 'contact.reservationUrl', sourceId: 'S1', quote: 'Reservas disponibles' },
      ],
    }, { sources: [
      { id: 'S1', kind: 'reservations', trust: 'third_party', url: 'https://meitre.com/cafe', text: 'Reservas disponibles' },
      { id: 'S2', kind: 'instagram', trust: 'official', url: 'https://www.instagram.com/cafebrasilero/', text: 'Handle: cafebrasilero\nMontevideo, Uruguay' },
    ] })
    expect(place.contact.reservationUrl).toBe('https://meitre.com/cafe')
    expect(place.contact.instagram).toBe('cafebrasilero')
  })

  it('aplica consistencia, prioriza horarios oficiales y normaliza el contacto', () => {
    const place = postProcess({ ...target, neighborhoodId: 'PARQUE RODO' }, {
      ...extraction,
      categories: ['wine_bar', 'cafe'], moments: [], foods: ['pastries'], drinks: [], features: ['terrace'], goodFor: [],
      outdoorSeating: 'unknown',
      hours: { raw: 'lunes 08:00 a 23:00', display: { es: 'Lunes, 08:00 a 23:00', en: 'Monday, 8 AM–11 PM' }, ranges: [
        { days: 'Mon', opens: '08:00', closes: '23:00' },
        { days: 'Tue', opens: '12:00', closes: '01:00' },
      ] },
      contact: {
        phone: '2418 5404', whatsapp: '094 679 778', instagram: '@CafeBrasilero',
        website: 'http://cafe.example/', menuUrl: null, reservationUrl: null,
      },
      description: {
        es: 'Un wine bar con vino de canilla, terraza y cocina a la vista.',
        en: 'A warm wine bar with a terrace.',
      },
      evidence: [
        { field: 'categories.wine_bar', sourceId: 'S1', quote: 'wine bar' },
        { field: 'categories.cafe', sourceId: 'S1', quote: 'café' },
        { field: 'features.terrace', sourceId: 'S1', quote: 'terraza' },
        { field: 'foods.pastries', sourceId: 'S1', quote: 'pastelería' },
        { field: 'hours.raw', sourceId: 'S1', quote: 'lunes 08:00 a 23:00' },
        { field: 'hours.ranges.0', sourceId: 'S1', quote: 'lunes 08:00 a 23:00' },
        { field: 'hours.ranges.1', sourceId: 'S2', quote: 'martes 12:00 a 01:00' },
        { field: 'contact.phone', sourceId: 'S1', quote: '2418 5404' },
        { field: 'contact.whatsapp', sourceId: 'S1', quote: '094 679 778' },
        { field: 'contact.instagram', sourceId: 'S1', quote: 'CafeBrasilero' },
        { field: 'contact.website', sourceId: 'S1', quote: 'cafe.example' },
      ],
    }, { sources: [
      { id: 'S1', kind: 'web', trust: 'official', url: 'https://cafe.example/', text: 'wine bar. café. terraza. pastelería. lunes 08:00 a 23:00. 2418 5404. 094 679 778. CafeBrasilero. cafe.example' },
      { id: 'S2', kind: 'exa', trust: 'third_party', url: 'https://exa.ai/', text: 'martes 12:00 a 01:00' },
    ] })

    expect(place.coordinates).toEqual(target.coordinates)
    expect(place.hours).toEqual({
      raw: 'lunes 08:00 a 23:00',
      display: { es: 'Lunes, 08:00 a 23:00', en: 'Monday, 8 AM–11 PM' },
      slots: [{ day: 1, opens: '08:00', closes: '23:00' }],
      status: 'exact', source: 'official',
    })
    expect(place.outdoorSeating).toBe('yes')
    expect(place.drinks).toContain('wine')
    expect(place.moments).toEqual(expect.arrayContaining(['drinks', 'breakfast', 'afternoon_snack']))
    expect(place.moments).not.toContain('late_night')
    expect(place.features).not.toContain('open_kitchen')
    expect(place.contact).toMatchObject({
      phone: '+598 2418 5404', whatsapp: '+598 94 679 778', instagram: 'cafebrasilero', website: 'https://cafe.example/',
    })
    expect(place.embeddingText).toContain('Parque Rodó')
    expect(place.embeddingText).not.toContain('PARQUE RODO')
  })

  it('normaliza el horario explícito de Exa y no conserva late_night a la 01:00', () => {
    const sources = [{
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/',
      text: 'Wine bar\nHorarios: Every day, 12:00 PM - 01:00 AM\nshared patio\nTarta de estación\nSpritz cítrico',
    }]
    const parsedHours = parseExplicitHours(sources)
    expect(parsedHours).toEqual([{
      raw: 'Horarios: Every day, 12:00 PM - 01:00 AM',
      sourceId: 'S1', trust: 'third_party',
      slots: expect.arrayContaining([{ day: 0, opens: '12:00', closes: '01:00' }]),
    }])

    const place = postProcess(target, {
      ...extraction,
      categories: ['wine_bar'], moments: ['late_night'], cuisines: [], foods: [], drinks: ['wine'], features: [], goodFor: [], hours: { raw: null, display: null, ranges: [] },
      outdoorSeating: 'unknown', highlights: [{ es: 'tarta de estación', en: 'seasonal tart' }, { es: 'spritz cítrico', en: 'citrus spritz' }],
      evidence: [
        { field: 'categories.wine_bar', sourceId: 'S1', quote: 'Wine bar' },
        { field: 'drinks.wine', sourceId: 'S1', quote: 'Wine bar' },
      ],
    }, { sources, parsedHours })

    expect(place.hours.slots).toHaveLength(7)
    expect(place.hours.source).toBe('third_party')
    expect(place.moments).not.toContain('late_night')
    expect(place.features).toContain('patio')
    expect(place.outdoorSeating).toBe('yes')
    expect(place.highlights).toEqual([{ es: 'tarta de estación', en: 'seasonal tart' }, { es: 'spritz cítrico', en: 'citrus spritz' }])
  })

  it('procesa El Palenque sin perder grill, normaliza horarios y conserva highlights en español', () => {
    const palenque = { ...target, name: 'El Palenque', address: '18 de Julio 1234' }
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://elpalenque.example/',
      text: 'Montevideo: Todos los días de 11.30 a 18.00hrs\nGalician pie',
    }
    const parsedHours = parseExplicitHours([source], { city: palenque.city, address: palenque.address })
    const place = postProcess(palenque, {
      ...extraction,
      categories: ['grill'], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [],
      highlights: [{ es: 'Pastel gallego', en: 'Galician pie' }],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [source], seedCategory: 'restaurant', parsedHours })

    expect(place.categories).toEqual(['grill', 'restaurant'])
    expect(place.hours).toMatchObject({ status: 'exact', slots: expect.arrayContaining([{ day: 0, opens: '11:30', closes: '18:00' }]) })
    expect(place.hours.slots).toHaveLength(7)
    expect(place.highlights).toEqual([{ es: 'Pastel gallego', en: 'Galician pie' }])
  })

  it.each(['hs', 'hrs', 'h', 'horas'])('acepta puntos y el sufijo %s en horarios', (suffix) => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: `Montevideo: Todos los días de 11.30${suffix} a 18.00${suffix}`,
    }
    const parsed = parseExplicitHours([source], { city: 'Montevideo', address: target.address })

    expect(parsed).toEqual([expect.objectContaining({
      slots: expect.arrayContaining([{ day: 0, opens: '11:30', closes: '18:00' }]),
    })])
  })

  it('selecciona la sucursal que coincide con el lugar y usa open_hours de Exa como respaldo', () => {
    const text = 'Montevideo: Todos los días de 11.30 a 18.00hrs. Punta del Este: Todos los días de 10.00 a 22.00hrs.'
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text }
    const parsed = parseExplicitHours([source], { city: 'Montevideo', address: target.address })
    expect(parsed).toEqual([expect.objectContaining({
      slots: expect.arrayContaining([{ day: 0, opens: '11:30', closes: '18:00' }]),
    })])

    const unmatched = { ...source, text: 'Punta del Este: Todos los días de 10.00 a 22.00hrs. Colonia: Todos los días de 09.00 a 17.00hrs.' }
    expect(parseExplicitHours([unmatched], { city: 'Montevideo', address: target.address })).toEqual([])

    const exaFallback = {
      ...unmatched, kind: 'exa' as const, trust: 'third_party' as const, hoursRaw: unmatched.text,
      hoursSlots: [{ days: 'Mon-Sun', opens: '11:30', closes: '18:00' }],
    }
    expect(parseExplicitHours([exaFallback], { city: 'Montevideo', address: target.address })[0].slots).toHaveLength(7)
  })

  it('expande rangos de Exa, conserva dos turnos y calcula estados', () => {
    expect(daysFromRange('Mon-Sun')).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(daysFromRange('Mon-Fri')).toEqual([1, 2, 3, 4, 5])
    expect(daysFromRange('Fri-Sat')).toEqual([5, 6])
    expect(daysFromRange('Tue-Sun')).toEqual([2, 3, 4, 5, 6, 0])
    expect(daysFromRange('todos los días')).toEqual([0, 1, 2, 3, 4, 5, 6])

    const sources = [{
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/',
      text: 'Horarios (texto original): Tue-Sun 12:00-15:30 y 19:00-00:30',
      hoursRaw: 'Tue-Sun 12:00-15:30 y 19:00-00:30',
      hoursSlots: [
        { days: 'Tue-Sun', opens: '12:00', closes: '15:30' },
        { days: 'Tue-Sun', opens: '19:00', closes: '00:30' },
      ],
    }]
    expect(parseExplicitHours(sources)[0].slots).toHaveLength(12)
    const place = postProcess(target, { ...extraction, hours: { raw: null, display: null, ranges: [] }, evidence: [] }, {
      sources,
      parsedHours: parseExplicitHours(sources),
    })
    expect(place.hours).toEqual({
      raw: 'Tue-Sun 12:00-15:30 y 19:00-00:30',
      display: { es: 'Martes a domingo: 12:00–15:30 y 19:00–00:30', en: 'Tuesday to Sunday: 12:00–15:30 and 19:00–00:30' },
      slots: expect.arrayContaining([
        { day: 2, opens: '12:00', closes: '15:30' },
        { day: 2, opens: '19:00', closes: '00:30' },
        { day: 0, opens: '12:00', closes: '15:30' },
        { day: 0, opens: '19:00', closes: '00:30' },
      ]),
      status: 'exact', source: 'third_party',
    })
    expect(place.hours.slots).toHaveLength(12)
    expect(place.moments).not.toContain('late_night')
  })

  it('genera display de horarios desde slots para Baker’s Bar y grupos discontinuos', () => {
    const bakerSlots = [2, 3, 4, 5, 6].map((day) => ({ day, opens: '20:00', closes: '02:00' }))
    const baker = postProcess(target, {
      ...extraction,
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { parsedHours: [{ raw: null, slots: bakerSlots, sourceId: 'S1', trust: 'third_party' }] })
    const discontinuous = postProcess(target, {
      ...extraction,
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { parsedHours: [{ raw: null, slots: [
      { day: 1, opens: '12:00', closes: null },
      { day: 3, opens: '12:00', closes: null },
    ], sourceId: 'S1', trust: 'third_party' }] })

    expect(baker.hours.display).toEqual({ es: 'Martes a sábado: 20:00–02:00', en: 'Tuesday to Saturday: 20:00–02:00' })
    expect(discontinuous.hours.display).toEqual({ es: 'Lunes: Desde las 12:00; Miércoles: Desde las 12:00', en: 'Monday: From 12:00; Wednesday: From 12:00' })
  })

  it('genera display para todos los días y conserva el display válido del modelo', () => {
    const allDays = postProcess(target, {
      ...extraction,
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { parsedHours: [{ raw: null, slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opens: '11:30', closes: '18:00' })), sourceId: 'S1', trust: 'third_party' }] })
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: 'Lunes 08:00 a 19:00' }
    const preserved = postProcess(target, {
      ...extraction,
      hours: { raw: 'Lunes 08:00 a 19:00', display: { es: 'Lunes, 08:00 a 19:00', en: 'Monday, 8 AM–7 PM' }, ranges: [{ days: 'Mon', opens: '08:00', closes: '19:00' }] },
      evidence: [
        { field: 'hours.raw', sourceId: 'S1', quote: 'Lunes 08:00 a 19:00' },
        { field: 'hours.ranges.0', sourceId: 'S1', quote: 'Lunes 08:00 a 19:00' },
      ],
    }, { sources: [source] })

    expect(allDays.hours.display).toEqual({ es: 'Todos los días: 11:30–18:00', en: 'Every day: 11:30–18:00' })
    expect(preserved.hours.display).toEqual({ es: 'Lunes, 08:00 a 19:00', en: 'Monday, 8 AM–7 PM' })
  })

  it('expande rangos oficiales devueltos por el LLM con la misma función que Exa', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://namaste.example/',
      text: 'Tue-Sun 12:00-15:30 y 19:00-00:30',
    }
    const place = postProcess(target, {
      ...extraction,
      hours: {
        raw: 'Tue-Sun 12:00-15:30 y 19:00-00:30', display: null,
        ranges: [
          { days: 'Tue-Sun', opens: '12:00', closes: '15:30' },
          { days: 'Tue-Sun', opens: '19:00', closes: '00:30' },
        ],
      },
      evidence: [
        { field: 'hours.raw', sourceId: 'S1', quote: 'Tue-Sun 12:00-15:30 y 19:00-00:30' },
        { field: 'hours.ranges.0', sourceId: 'S1', quote: 'Tue-Sun 12:00-15:30' },
        { field: 'hours.ranges.1', sourceId: 'S1', quote: '19:00-00:30' },
      ],
    }, { sources: [source] })

    expect(place.hours.source).toBe('official')
    expect(place.hours.slots).toEqual([
      { day: 0, opens: '12:00', closes: '15:30' },
      { day: 0, opens: '19:00', closes: '00:30' },
      { day: 2, opens: '12:00', closes: '15:30' },
      { day: 2, opens: '19:00', closes: '00:30' },
      { day: 3, opens: '12:00', closes: '15:30' },
      { day: 3, opens: '19:00', closes: '00:30' },
      { day: 4, opens: '12:00', closes: '15:30' },
      { day: 4, opens: '19:00', closes: '00:30' },
      { day: 5, opens: '12:00', closes: '15:30' },
      { day: 5, opens: '19:00', closes: '00:30' },
      { day: 6, opens: '12:00', closes: '15:30' },
      { day: 6, opens: '19:00', closes: '00:30' },
    ])
  })

  it('conserva highlights presentes en fuentes aunque su evidencia esté ausente o mal indexada', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://namaste.example/',
      text: 'Sorrentinos caseros. Chivitos veganos. Wok de verduras. Crepes dulces.',
    }
    const place = postProcess(target, {
      ...extraction,
      highlights: [
        { es: 'sorrentinos', en: 'sorrentinos' },
        { es: 'chivitos veganos', en: 'vegan chivitos' },
        { es: 'wok de verduras', en: 'vegetable wok' },
        { es: 'crepes dulces', en: 'sweet crepes' },
        { es: 'plato inexistente', en: 'missing dish' },
      ],
      evidence: [{ field: 'highlights.9', sourceId: 'S1', quote: 'Sorrentinos caseros' }],
    }, { sources: [source] })

    expect(place.highlights).toEqual([
      { es: 'sorrentinos', en: 'sorrentinos' },
      { es: 'chivitos veganos', en: 'vegan chivitos' },
      { es: 'wok de verduras', en: 'vegetable wok' },
      { es: 'crepes dulces', en: 'sweet crepes' },
    ])
  })

  it('calcula partial, vague y none sin inferir late_night con cierres faltantes', () => {
    const source = { id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://cafe.example/', text: 'Abierto desde las 12. Hasta tarde.' }
    const partial = postProcess(target, {
      ...extraction,
      moments: ['late_night'],
      hours: { raw: 'Abierto desde las 12', display: { es: 'Desde las 12:00', en: 'From noon' }, ranges: [{ days: 'Mon', opens: '12:00', closes: null }] },
      evidence: [
        { field: 'hours.raw', sourceId: 'S1', quote: 'Abierto desde las 12' },
        { field: 'hours.ranges.0', sourceId: 'S1', quote: 'Abierto desde las 12' },
      ],
    }, { sources: [source] })
    expect(partial.hours).toEqual({ raw: 'Abierto desde las 12', display: { es: 'Desde las 12:00', en: 'From noon' }, slots: [{ day: 1, opens: '12:00', closes: null }], status: 'partial', source: 'official' })
    expect(partial.moments).not.toContain('late_night')

    const vague = postProcess(target, {
      ...extraction, hours: { raw: 'Hasta tarde', display: { es: 'Hasta tarde', en: 'Until late' }, ranges: [] }, evidence: [{ field: 'hours.raw', sourceId: 'S1', quote: 'Hasta tarde' }],
    }, { sources: [source] })
    expect(vague.hours).toEqual({ raw: 'Hasta tarde', display: { es: 'Hasta tarde', en: 'Until late' }, slots: [], status: 'vague', source: 'official' })

    const none = postProcess(target, { ...extraction, hours: { raw: null, display: null, ranges: [] }, evidence: [] }, { sources: [source] })
    expect(none.hours).toEqual({ raw: null, display: null, slots: [], status: 'none', source: null })
  })

  it.each(['Not available', 'N/A', 'No disponible'])('normaliza %s como horarios no disponibles', (hoursRaw) => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/',
      text: `Horarios: ${hoursRaw}`, hoursRaw, hoursSlots: [],
    }
    expect(parseExplicitHours([source])).toEqual([])

    const place = postProcess(target, {
      ...extraction,
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source], parsedHours: parseExplicitHours([source]) })

    expect(place.hours).toEqual({ raw: null, display: null, slots: [], status: 'none', source: null })
  })

  it('agrega foods exclusivamente desde los ítems de menú de Exa', () => {
    const menuSource = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Resumen de Exa',
      menu: ['Veggie or vegan chivitos', 'Wok de fideos de arroz', 'Mousse de maracuyá', 'Hamburguesa de lentejas'],
    }
    const fromMenu = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [menuSource] })
    expect(fromMenu.foods).toEqual(expect.arrayContaining(['chivito', 'wok', 'desserts', 'burgers']))

    const textOnlySource = { ...menuSource, text: 'Hamburguesa de lentejas', menu: [] }
    const fromTextOnly = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [textOnlySource] })
    expect(fromTextOnly.foods).not.toContain('burgers')
  })

  it('agrega features desde campos estructurados de Exa y activa outdoorSeating', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Resumen de Exa',
      exaDescription: 'Street-side tables, DJs y open kitchen.',
      exaKnowsBeforeYouGo: 'Terraza rooftop con patio compartido y música en vivo.',
      menu: ['Bandas en vivo'],
    }
    const place = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [], outdoorSeating: 'unknown',
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [source] })

    expect(place.features).toEqual(expect.arrayContaining(['sidewalk', 'dj', 'open_kitchen', 'terrace', 'patio', 'live_music']))
    expect(place.outdoorSeating).toBe('yes')
  })

  it('no detecta features desde la descripción del LLM ni desde barra aislada', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Resumen de Exa',
      exaDescription: 'Barra amplia.', exaKnowsBeforeYouGo: '', menu: [],
    }
    const place = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [], outdoorSeating: 'unknown',
      description: { es: 'Tiene una terraza y patio luminoso.', en: 'It has a bright terrace and patio.' },
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [source] })

    expect(place.features).toEqual([])
    expect(place.outdoorSeating).toBe('unknown')
  })

  it('agrega lunch y dinner desde foods y horarios sin categoría restaurant', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Resumen de Exa', menu: ['Pizza napolitana'],
      hoursRaw: 'Todos los días de 12:00 a 22:00', hoursSlots: [{ days: 'Mon-Sun', opens: '12:00', closes: '22:00' }],
    }
    const place = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [source], parsedHours: parseExplicitHours([source]) })

    expect(place.categories).toEqual([])
    expect(place.foods).toContain('pizza')
    expect(place.moments).toEqual(expect.arrayContaining(['lunch', 'dinner']))
  })

  it('agrega dinner desde hours.raw y excluye picada y desserts de los nuevos moments', () => {
    const dinnerSource = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Resumen de Exa', menu: ['Pizza napolitana'],
      hoursRaw: 'Cena desde las 18:00', hoursSlots: [{ days: 'Mon-Sun', opens: '18:00', closes: '20:00' }],
    }
    const dinner = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [dinnerSource], parsedHours: parseExplicitHours([dinnerSource]) })
    const snacks = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [{ ...dinnerSource, menu: ['Picada para compartir', 'Postres'] }], parsedHours: parseExplicitHours([{ ...dinnerSource, menu: ['Picada para compartir', 'Postres'] }]) })

    expect(dinner.moments).toContain('dinner')
    expect(snacks.moments).not.toContain('lunch')
    expect(snacks.moments).not.toContain('dinner')
  })

  it('agrega signature y classic cocktails para Baker’s Bar', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/',
      text: 'Baker’s Bar es un cocktail bar.', exaDescription: 'Cocktail bar de Montevideo.',
    }
    const place = postProcess(target, {
      ...extraction,
      categories: ['bar'], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [source] })

    expect(place.drinks).toEqual(['signature_cocktails', 'classic_cocktails'])
  })

  it('detecta drinks de Exa y highlights sin usar sinónimos ambiguos', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Pisco sour',
      exaDescription: 'Bar de cócteles con gintonic.',
      exaKnowsBeforeYouGo: 'Probá el Moscow mule.',
      menu: ['Negroni'],
    }
    const place = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [],
      highlights: [{ es: 'Pisco sour', en: 'Pisco sour' }],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [source] })
    const ambiguous = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [{ ...source, text: 'Resumen', exaDescription: 'Cerveza en canilla, copas en la barra y tragos after.', exaKnowsBeforeYouGo: '', menu: [] }] })

    expect(place.drinks).toEqual(expect.arrayContaining(['signature_cocktails', 'classic_cocktails', 'gin']))
    expect(ambiguous.drinks).toEqual([])
  })

  it('mantiene Oriundo limitado a wine, vermouth, signature y non_alcoholic', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Wine bar.',
      exaDescription: 'Coctelería de autor.', exaKnowsBeforeYouGo: 'Vermut y mocktails.', menu: [],
    }
    const place = postProcess(target, {
      ...extraction,
      categories: ['wine_bar'], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    }, { sources: [source] })

    expect(place.drinks).toEqual(expect.arrayContaining(['wine', 'vermouth', 'signature_cocktails', 'non_alcoholic']))
    expect(place.drinks).toHaveLength(4)
    expect(place.drinks).not.toContain('classic_cocktails')
  })

  it('marca reservas como accepts por una fuente aunque no haya URL de reserva', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: 'Reservas por WhatsApp al 099 123 456.',
    }
    const place = postProcess(target, {
      ...extraction,
      reservations: 'unknown',
      contact: { ...extraction.contact, reservationUrl: null },
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source] })

    expect(place.reservations).toBe('accepts')
    expect(place.contact.reservationUrl).toBeNull()
  })

  it('respeta una negación explícita de reservas', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: 'No se aceptan reservas.',
    }
    const place = postProcess(target, {
      ...extraction,
      reservations: 'no_reservations',
      hours: { raw: null, display: null, ranges: [] },
      evidence: [{ field: 'reservations', sourceId: 'S1', quote: 'No se aceptan reservas' }],
    }, { sources: [source] })

    expect(place.reservations).toBe('no_reservations')
  })

  it('agrega foods desde highlights en español sin usar el texto inglés', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: 'Medialunas recién horneadas. Hamburguesas de lentejas. Burger special.',
    }
    const place = postProcess(target, {
      ...extraction,
      foods: ['pastries'],
      highlights: [
        { es: 'Hamburguesas de lentejas', en: 'Lentil burgers' },
        { es: 'Burger special', en: 'Hamburguesa especial' },
      ],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [{ field: 'foods.pastries', sourceId: 'S1', quote: 'Medialunas recién horneadas' }],
    }, { sources: [source] })

    expect(place.foods).toEqual(expect.arrayContaining(['pastries', 'burgers']))
    expect(place.foods).not.toContain('chivito')
  })

  it('ignora carne y carnes para FOODS en menús y highlights de un restaurante vegetariano', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/',
      text: 'Restaurante vegetariano. Pastel de carne vegetal.',
      menu: ['Pastel de carne vegetal'],
    }
    const place = postProcess(target, {
      ...extraction,
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      foods: ['grilled_meat'],
      highlights: [{ es: 'Pastel de carne vegetal', en: 'Plant-based meat pie' }],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [{ field: 'foods.grilled_meat', sourceId: 'S1', quote: 'Pastel de carne vegetal' }],
    }, { sources: [source] })

    expect(place.dietary.vegetarian).toBe('fully')
    expect(place.foods).not.toContain('grilled_meat')
  })

  it('no usa carne ni carnes como sinónimos de grilled_meat, pero conserva los nuevos sinónimos específicos', () => {
    const noMeat = postProcess(target, {
      ...extraction,
      foods: ['grilled_meat'],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [{ field: 'foods.grilled_meat', sourceId: 'S1', quote: 'Carne al plato' }],
    }, { sources: [{ id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/', text: 'Carne al plato' }] })
    const lamb = postProcess(target, {
      ...extraction,
      foods: ['grilled_meat'],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [{ field: 'foods.grilled_meat', sourceId: 'S1', quote: 'Lamb chops' }],
    }, { sources: [{ id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/', text: 'Lamb chops' }] })

    expect(noMeat.foods).not.toContain('grilled_meat')
    expect(lamb.foods).toContain('grilled_meat')
  })

  it('marca restaurante vegetariano con opciones veganas como vegetariano fully y vegano has_options', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: 'Restaurante vegetariano con opciones veganas.',
    }
    const place = postProcess(target, {
      ...extraction,
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source] })

    expect(place.dietary).toMatchObject({ vegan: 'has_options', vegetarian: 'fully' })
  })

  it('interpreta restaurante vegano y vegetariano como vegetariano con opciones veganas', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: 'Restaurante vegano y vegetariano.',
    }
    const place = postProcess(target, {
      ...extraction,
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source] })

    expect(place.dietary).toMatchObject({ vegan: 'has_options', vegetarian: 'fully' })
  })

  it.each([
    '100% vegano',
    '100% vegan',
    'Todo vegano',
    'Totalmente vegano',
    'Plant-based restaurant',
    'Restaurante vegano',
  ])('marca %s como vegan fully', (signal) => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: signal,
    }
    const place = postProcess(target, {
      ...extraction,
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source] })

    expect(place.dietary).toMatchObject({ vegan: 'fully', vegetarian: 'fully' })
  })

  it('reduce vegan fully ante queso no vegano del menú estructurado de Exa', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/',
      text: '100% vegano.', menu: ['Tostada con queso'],
    }
    const place = postProcess(target, {
      ...extraction,
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source] })

    expect(place.dietary).toMatchObject({ vegan: 'has_options', vegetarian: 'fully' })
  })

  it('reduce vegan fully ante queso no vegano en highlights validados', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: '100% vegan. Tarta de queso con huevo.',
    }
    const place = postProcess(target, {
      ...extraction,
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      highlights: [{ es: 'Tarta de queso con huevo', en: 'Cheese and egg tart' }],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source] })

    expect(place.dietary).toMatchObject({ vegan: 'has_options', vegetarian: 'fully' })
  })

  it('no reduce vegan fully por queso vegano', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/',
      text: '100% vegano.', menu: ['Pizza con queso vegano'],
    }
    const place = postProcess(target, {
      ...extraction,
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source] })

    expect(place.dietary).toMatchObject({ vegan: 'fully', vegetarian: 'fully' })
  })

  it('agrega breakfast y afternoon_snack a cafés y panaderías, y brunch desde fuentes', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://cafe.example/',
      text: 'Café y panadería con brunch los fines de semana.',
    }
    const place = postProcess(target, {
      ...extraction,
      categories: ['cafe', 'bakery'], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [
        { field: 'categories.cafe', sourceId: 'S1', quote: 'Café' },
        { field: 'categories.bakery', sourceId: 'S1', quote: 'panadería' },
      ],
    }, { sources: [source] })

    expect(place.moments).toEqual(expect.arrayContaining(['breakfast', 'afternoon_snack', 'brunch']))
  })

  it('agrega categorías inequívocas y momentos con horarios parciales sin reemplazar la semilla', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/',
      text: 'Restaurant bar. Wine bar, vinoteca, cervecería, brewpub, taproom, coffee shop y cafetería. Cena hasta tarde. Lunes desde las 12.',
    }
    const place = postProcess(target, {
      ...extraction,
      categories: ['restaurant', 'bar'], moments: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: 'Lunes desde las 12', display: null, ranges: [{ days: 'Mon', opens: '12:00', closes: null }] },
      evidence: [
        { field: 'categories.restaurant', sourceId: 'S1', quote: 'Restaurant' },
        { field: 'categories.bar', sourceId: 'S1', quote: 'bar' },
        { field: 'hours.raw', sourceId: 'S1', quote: 'Lunes desde las 12' },
        { field: 'hours.ranges.0', sourceId: 'S1', quote: 'Lunes desde las 12' },
      ],
    }, { sources: [source], seedCategory: 'bakery' })

    expect(place.categories).toEqual(expect.arrayContaining(['restaurant', 'bar', 'bakery', 'wine_bar', 'brewery', 'cafe']))
    expect(place.moments).toEqual(expect.arrayContaining(['drinks', 'lunch', 'dinner']))
    expect(place.hours.status).toBe('partial')
  })

  it('deriva restaurant, foods y cuisine desde categorías antes de calcular moments', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: 'Categorías y horarios publicados. Medialunas recién horneadas.',
    }
    const place = postProcess(target, {
      ...extraction,
      categories: ['grill', 'pizzeria', 'chiviteria', 'ice_cream_shop'], moments: [], cuisines: [], foods: ['pastries'], drinks: [], features: [], goodFor: [], highlights: [],
      hours: { raw: 'Todos los días 12:00 a 23:00', display: null, ranges: [{ days: 'Mon-Sun', opens: '12:00', closes: '23:00' }] },
      evidence: [
        { field: 'categories.grill', sourceId: 'S1', quote: 'Categorías y horarios publicados' },
        { field: 'categories.pizzeria', sourceId: 'S1', quote: 'Categorías y horarios publicados' },
        { field: 'categories.chiviteria', sourceId: 'S1', quote: 'Categorías y horarios publicados' },
        { field: 'categories.ice_cream_shop', sourceId: 'S1', quote: 'Categorías y horarios publicados' },
        { field: 'foods.pastries', sourceId: 'S1', quote: 'Medialunas recién horneadas' },
        { field: 'hours.ranges.0', sourceId: 'S1', quote: 'Categorías y horarios publicados' },
      ],
    }, { sources: [source], seedCategory: 'grill', parsedHours: [{ raw: 'Todos los días 12:00 a 23:00', slots: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, opens: '12:00', closes: '23:00' })), sourceId: 'S1', trust: 'official' }] })

    expect(place.categories).toEqual(expect.arrayContaining(['grill', 'restaurant']))
    expect(place.foods).toEqual(expect.arrayContaining(['pastries', 'grilled_meat', 'pizza', 'chivito', 'ice_cream']))
    expect(place.cuisines).toContain('uruguayan')
    expect(place.moments).toEqual(expect.arrayContaining(['lunch', 'dinner']))
  })

  it.each([
    ['grill', 'grilled_meat'],
    ['pizzeria', 'pizza'],
    ['chiviteria', 'chivito'],
    ['ice_cream_shop', 'ice_cream'],
  ] as const)('agrega %s desde la categoría %s', (category, food) => {
    const place = postProcess(target, {
      ...extraction,
      categories: [], cuisines: [], foods: [],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { seedCategory: category })

    expect(place.foods).toContain(food)
    if (category === 'ice_cream_shop') expect(place.categories).not.toContain('restaurant')
    else expect(place.categories).toContain('restaurant')
    if (category === 'grill') expect(place.cuisines).toContain('uruguayan')
  })

  it('mantiene la protección dietaria frente a grilled_meat inferido por categoría', () => {
    const source = {
      id: 'S1', kind: 'web' as const, trust: 'official' as const, url: 'https://local.example/', text: 'Restaurante vegetariano.',
    }
    const place = postProcess(target, {
      ...extraction,
      categories: ['grill'], foods: [],
      dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
      hours: { raw: null, display: null, ranges: [] },
      evidence: [],
    }, { sources: [source], seedCategory: 'grill' })

    expect(place.dietary.vegetarian).toBe('fully')
    expect(place.foods).not.toContain('grilled_meat')
  })

  it('agrega cuisines desde menú y descripción estructurada de Exa, con prioridad y límite de tres', () => {
    const source = {
      id: 'S1', kind: 'exa' as const, trust: 'third_party' as const, url: 'https://exa.ai/', text: 'Menú de referencia.',
      exaDescription: 'Cocina española gallega y comida italiana.',
      menu: ['Curry de la casa', 'Plato japonés'],
    }
    const place = postProcess(target, {
      ...extraction,
      cuisines: ['uruguayan', 'italian', 'mexican'],
      hours: { raw: null, display: null, ranges: [] },
      evidence: [
        { field: 'cuisines.uruguayan', sourceId: 'S1', quote: 'Menú de referencia' },
        { field: 'cuisines.italian', sourceId: 'S1', quote: 'Menú de referencia' },
        { field: 'cuisines.mexican', sourceId: 'S1', quote: 'Menú de referencia' },
      ],
    }, { sources: [source] })

    expect(place.cuisines).toEqual(['italian', 'spanish', 'indian'])
  })

  it('prioriza precios determinísticos por persona y respeta sus límites', () => {
    const priceFrom = (sources: { id: string; kind: 'web'; trust: 'official' | 'third_party'; url: string; text: string }[]) => postProcess(target, {
      ...extraction,
      price: 'very_high',
      evidence: [],
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
      evidence: [],
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

    const noPrice = postProcess(target, { ...extraction, price: 'high', evidence: [] }, { sources: [{
      id: 'S1', kind: 'web', trust: 'official', url: 'https://local.example/',
      text: 'Precio promedio US$ 25 por persona. Copa $500.',
    }] })
    expect(noPrice.price).toBe('unknown')
  })

  it('no agrega draft_beer por sinónimos presentes sólo en la descripción', () => {
    const place = postProcess(target, {
      ...extraction,
      categories: [], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
      description: { es: 'Un wine bar de vinos de canilla.', en: 'A wine bar with wine on tap.' },
      hours: { raw: null, display: null, ranges: [] }, evidence: [],
    })
    expect(place.drinks).not.toContain('draft_beer')
    expect(place.categories).toEqual([])
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
        ...extraction,
        categories: [], moments: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [], hours: { raw: null, display: null, ranges: [] },
        contact: { ...extraction.contact, instagram: 'oriundo.uy' },
        evidence: [{ field: 'contact.instagram', sourceId: 'S1', quote: '@oriundo.uy' }],
      }),
    })

    const result = await service.extract('place-1', { name: target.name, seedCategory: 'cafe' })
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
      categories: ['wine_bar'],
      reservations: 'no_reservations',
      contact: { ...extraction.contact, phone: '000', instagram: 'marca-ajena', website: 'https://incorrecta.example/', reservationUrl: null },
      evidence: [{ field: 'categories.wine_bar', sourceId: 'S1', quote: 'wine bar' }],
    }, {
      seedCategory: 'bar',
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
        ranges: [
          { days: 'Tue-Sun', opens: '12:00', closes: '15:30' },
          { days: 'Tue-Sun', opens: '19:00', closes: '00:30' },
        ],
      },
      'Culto Café': {
        highlights: [{ es: 'crepe de cacao', en: 'cocoa crepe' }],
        hoursRaw: 'Mon 09:00-18:00',
        ranges: [{ days: 'Mon', opens: '09:00', closes: '18:00' }],
      },
      Oriundo: {
        highlights: [{ es: 'tartín de temporada', en: 'seasonal tartin' }],
        hoursRaw: 'Fri-Sat 19:00-01:00',
        ranges: [{ days: 'Fri-Sat', opens: '19:00', closes: '01:00' }],
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
          ...extraction,
          categories: [], moments: [], foods: [], drinks: [], features: [], goodFor: [],
          highlights: fixture.highlights.map((highlight) => ({ ...highlight })),
          hours: { raw: fixture.hoursRaw, display: null, ranges: fixture.ranges.map((range) => ({ ...range })) },
          evidence: [
            { field: 'hours.raw', sourceId: 'S1', quote: fixture.hoursRaw },
            ...fixture.ranges.map((range, index) => ({ field: `hours.ranges.${index}`, sourceId: 'S1', quote: `${range.opens}-${range.closes}` })),
          ],
        }
      },
    })

    for (const name of ['Namasté', 'Culto Café', 'Oriundo'] as const) {
      const response = await service.extract(`${name}-place`, { name, seedCategory: 'restaurant' })
      expect(response).toMatchObject({ status: 'ok', place: { highlights: fixtures[name].highlights } })
      expect(response.place?.hours.slots).toHaveLength(name === 'Namasté' ? 12 : name === 'Culto Café' ? 1 : 2)
    }
  })

  it('mantiene Oriundo estable en tres extracciones refrescadas', async () => {
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
          ...extraction,
          categories: runs % 2 ? ['wine_bar'] : [],
          moments: [], foods: [], drinks: [], features: [], goodFor: [], highlights: [],
          hours: { raw: null, display: null, ranges: [] },
          contact: { ...extraction.contact, instagram: 'magnolio.uy', reservationUrl: null },
          evidence: runs % 2 ? [{ field: 'categories.wine_bar', sourceId: 'S1', quote: 'wine bar' }] : [],
        }
      },
    })

    const responses = []
    for (let index = 0; index < 3; index += 1) {
      responses.push(await service.extract('oriundo-place', { name: 'Oriundo', seedCategory: 'bar', refresh: true }))
    }
    for (const response of responses) {
      expect(response).toMatchObject({
        status: 'ok',
        place: { categories: expect.arrayContaining(['bar']), contact: { instagram: 'oriundo.uy', reservationUrl: 'https://oriundo.meitre.com/' } },
      })
    }
    expect(runs).toBe(3)
  })
})
