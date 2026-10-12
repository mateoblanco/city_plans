import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { PlacesProviderError, type PlacesProvider } from './providers/places-provider.ts'

const validRequest = {
  mode: 'filters',
  barrio: 'Pocitos',
  placeType: 'restaurant',
}

describe('POST /api/places/search', () => {
  it('rechaza búsquedas cuando falta configurar la clave', async () => {
    const response = await createApp().request('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validRequest),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: {
        code: 'CONFIGURATION_ERROR',
        message: 'Falta configurar GOOGLE_PLACES_API_KEY en .env.local.',
      },
    })
  })

  it('rechaza barrios, tipos y tokens inválidos antes de llamar al provider', async () => {
    const search = vi.fn()
    const provider = { search } as PlacesProvider
    const app = createApp({ provider })

    const invalidCategory = await app.request('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'filters', barrio: 'Pocitos', placeType: 'anything' }),
    })
    const invalidNeighborhood = await app.request('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'filters', barrio: 'Otra ciudad', placeType: 'restaurant' }),
    })
    const invalidToken = await app.request('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validRequest, pageToken: '' }),
    })

    expect(invalidCategory.status).toBe(400)
    expect(invalidNeighborhood.status).toBe(400)
    expect(invalidToken.status).toBe(400)
    expect(search).not.toHaveBeenCalled()
  })

  it('envía criterios permitidos y devuelve una página normalizada', async () => {
    const page = {
      items: [
        {
          placeId: 'place-1',
          name: 'Café Montevideo',
          type: 'Café',
          googleMapsUri: 'https://maps.google.com/place-1',
        },
      ],
      nextPageToken: 'next-page',
    }
    const search = vi.fn().mockResolvedValue(page)
    const response = await createApp({ provider: { search } }).request(
      '/api/places/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validRequest, pageToken: 'page-1' }),
      },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(search).toHaveBeenCalledWith({ ...validRequest, pageToken: 'page-1' })
    expect(await response.json()).toEqual(page)
  })

  it('acepta texto libre válido y rechaza consultas demasiado cortas', async () => {
    const search = vi.fn().mockResolvedValue({ items: [], nextPageToken: null })
    const app = createApp({ provider: { search } })

    const valid = await app.request('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'text', query: 'Café Brasilero', seedCategory: 'cafe' }),
    })
    const invalid = await app.request('/api/places/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'text', query: 'x' }),
    })

    expect(valid.status).toBe(200)
    expect(invalid.status).toBe(400)
    expect(search).toHaveBeenCalledWith({
      mode: 'text',
      query: 'Café Brasilero',
      seedCategory: 'cafe',
      pageToken: undefined,
    })
  })
})

describe('exploración multi-fuente', () => {
  it('devuelve el detalle exacto de Google por placeId', async () => {
    const details = {
      source: 'google' as const,
      exactMatch: true as const,
      anchor: {
        name: 'Café Brasilero',
        address: 'Ituzaingó 1447',
        latitude: -34.906,
        longitude: -56.202,
      },
      data: { id: 'place-1', rating: 4.7 },
      websiteUri: 'https://cafebrasilero.com.uy/',
      attribution: 'Google Maps',
    }
    const getDetails = vi.fn().mockResolvedValue(details)
    const app = createApp({
      provider: {
        search: vi.fn(),
        getDetails,
      },
    })

    const response = await app.request('/api/places/place-1/google-details')

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(getDetails).toHaveBeenCalledWith('place-1')
    expect(await response.json()).toEqual(details)
  })

  it('valida el ancla y devuelve candidatos con el envelope común', async () => {
    const provider = {
      source: 'overture' as const,
      attribution: 'Overture Maps Foundation',
      configured: true,
      findCandidates: vi.fn().mockResolvedValue([{
        name: 'Café Brasilero',
        address: 'Ituzaingó 1447',
        latitude: -34.906,
        longitude: -56.202,
        data: { id: 'overture-1' },
      }]),
    }
    const app = createApp({ matchProviders: { overture: provider } })
    const anchor = {
      name: 'Café Brasilero',
      address: 'Ituzaingó 1447',
      latitude: -34.906,
      longitude: -56.202,
    }

    const response = await app.request('/api/place-matches/overture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anchor }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      source: 'overture',
      matchMethod: 'spatial_name_v2',
      bestMatch: { data: { id: 'overture-1' } },
      attribution: 'Overture Maps Foundation',
    })
  })

  it('no expone el endpoint de scraping web', async () => {
    const app = createApp()
    const response = await app.request('/api/places/place-1/scrape', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh: true }),
    })
    expect(response.status).toBe(404)
  })

  it('POST /api/extraction-reports valida el lote, escribe el reporte y lo resume en consola', async () => {
    const reportWriter = vi.fn().mockResolvedValue('output/report-2026-10-10_22-00-00.json')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = createApp({ reportWriter })
    const post = (body: unknown) => app.request('/api/extraction-reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const stats = {
      hoursStatus: 'partial', hasInstagram: true, hasWebsite: false, tagCount: 8, costUsd: 0.1, totalMs: 30_000,
      sourcesUsd: 0.06, mainLlmUsd: 0.04, hoursRetryUsd: 0, inputTokens: 10_000, cachedInputTokens: 3_000, cacheWriteTokens: 0,
    }
    const hoursRetry = { attempted: false, recovered: false, costUsd: 0 }
    const response = await post({
      places: [{
        name: 'Oviedo Bar', googlePlaceId: 'place-1', stats,
        review: { unmappedFacts: [{ id: 'F3', text: 'Noches de karaoke', proposedTag: 'karaoke' }], doubts: ['No sé si es bar o boliche'], anomalies: [{ type: 'hours_no_close', detail: 'lun desde 18:00' }], hoursRetry },
      }, {
        name: 'Sin fuentes', googlePlaceId: 'place-2', stats: { ...stats, hoursStatus: 'none', tagCount: 0 }, review: null,
      }],
    })
    const invalidType = await post({ places: [{ name: 'X', googlePlaceId: 'p', stats, review: { unmappedFacts: [], doubts: [], anomalies: [{ type: 'otra', detail: '' }], hoursRetry } }] })
    const missingStats = await post({ places: [{ name: 'X', googlePlaceId: 'p', review: null }] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ path: 'output/report-2026-10-10_22-00-00.json' })
    expect(reportWriter).toHaveBeenCalledTimes(1)
    expect(reportWriter.mock.calls[0][0]).toMatchObject({
      summary: { placesProcessed: 2, hours: { exact: 0, partial: 1, vague: 0, none: 1 } },
      byType: {
        unmapped_fact: [{ name: 'Oviedo Bar', googlePlaceId: 'place-1', text: 'Noches de karaoke', proposedTag: 'karaoke' }],
        llm_doubt: [{ name: 'Oviedo Bar', googlePlaceId: 'place-1', text: 'No sé si es bar o boliche' }],
        hours_no_close: [{ name: 'Oviedo Bar', googlePlaceId: 'place-1', detail: 'lun desde 18:00' }],
      },
    })
    expect(log).toHaveBeenCalledWith('Reporte del lote: output/report-2026-10-10_22-00-00.json')
    expect(log).toHaveBeenCalledWith([
      '2 lugares · unmapped_fact: 1 · llm_doubt: 1 · hours_no_close: 1',
      'Horarios recuperados con la segunda búsqueda: 0 de 0 (USD 0.0000)',
      'Costo USD 0.2000: fuentes 0.1200 · LLM principal 0.0800 · segunda búsqueda 0.0000',
      'Tokens cacheados: 6000 de 20000 (30%) · escritos en cache: 0',
    ].join('\n'))
    expect(invalidType.status).toBe(400)
    expect(missingStats.status).toBe(400)
    log.mockRestore()
  })

  it('POST /api/extract procesa un lugar y valida ID, categorías y barrio', async () => {
    const result = {
      source: 'llm' as const,
      status: 'ok' as const,
      model: 'gpt-5-mini' as const,
      sourceAudit: { google: true, exa: true, instagram: false, instagramCandidates: [] },
      place: {
        name: 'Café Brasilero',
        address: 'Ituzaingó 1447',
        coordinates: { lat: -34.906, lng: -56.202, source: 'google' as const, fetchedAt: '2026-10-01T00:00:00.000Z' },
        neighborhoodId: 'CIUDAD VIEJA',
        city: 'Montevideo' as const,
        googlePlaceId: 'place-1',
        transit: { status: 'success' as const, lines: [] },
        categories: ['cafe'], tags: [],
        dietary: { vegan: 'unknown' as const, vegetarian: 'unknown' as const, glutenFree: 'unknown' as const },
        price: 'unknown' as const, reservations: 'unknown' as const,
        hours: { raw: null, display: null, slots: [], status: 'none' as const, source: null }, contact: { phone: null, whatsapp: null, instagram: null, website: null, menuUrl: null, reservationUrl: null },
        highlights: [], description: { es: 'Un café.', en: 'A café.' }, placeFacts: [], searchText: 'Café Brasilero.',
      },
      review: { unmappedFacts: [], doubts: [], anomalies: [], hoursRetry: { attempted: false, recovered: false, costUsd: 0 } },
      attribution: 'Sitio web del local · Instagram vía Apify' as const,
    }
    const extract = vi.fn().mockResolvedValue(result)
    const app = createApp({ extractor: { configured: true, extract } })
    const post = (body: unknown) => app.request('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const response = await post({ googlePlaceId: 'place-1', seedCategories: ['cafe', 'bar'], neighborhoodId: 'CIUDAD VIEJA' })
    const withoutNeighborhood = await post({ googlePlaceId: 'place-2', seedCategories: ['cafe'] })
    const invalidId = await post({ googlePlaceId: '!', seedCategories: ['cafe'] })
    const missingId = await post({ seedCategories: ['cafe'] })
    const missingSeed = await post({ googlePlaceId: 'place-1' })
    const invalidSeed = await post({ googlePlaceId: 'place-1', seedCategories: ['otra'] })
    const emptySeed = await post({ googlePlaceId: 'place-1', seedCategories: [] })
    const invalidNeighborhood = await post({ googlePlaceId: 'place-1', seedCategories: ['cafe'], neighborhoodId: 'OTRA CIUDAD' })
    const oldEndpoint = await app.request('/api/places/place-1/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Café Brasilero', seedCategories: ['cafe'] }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual(result)
    expect(extract).toHaveBeenNthCalledWith(1, 'place-1', { seedCategories: ['cafe', 'bar'], neighborhoodId: 'CIUDAD VIEJA' })
    expect(withoutNeighborhood.status).toBe(200)
    expect(extract).toHaveBeenNthCalledWith(2, 'place-2', { seedCategories: ['cafe'] })
    for (const invalid of [invalidId, missingId, missingSeed, invalidSeed, emptySeed, invalidNeighborhood]) {
      expect(invalid.status).toBe(400)
    }
    expect(extract).toHaveBeenCalledTimes(2)
    expect(oldEndpoint.status).toBe(404)
  })

  it('informa cuando Vercel AI Gateway no está configurado', async () => {
    const response = await createApp().request('/api/extract', { method: 'POST' })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar AI_GATEWAY_API_KEY en .env.local.' },
    })
  })

  it('normaliza límites de Vercel AI Gateway con el envelope de API', async () => {
    const app = createApp({
      extractor: {
        configured: true,
        extract: vi.fn().mockRejectedValue(new PlacesProviderError('quota', 'Vercel AI Gateway limitó temporalmente las consultas.')),
      },
    })
    const response = await app.request('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ googlePlaceId: 'place-1', seedCategories: ['cafe'] }) })
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({
      error: { code: 'QUOTA_ERROR', message: 'Vercel AI Gateway limitó temporalmente las consultas.' },
    })
  })

  it('consulta Exa con un nombre validado y conserva la respuesta estructurada', async () => {
    const exaResponse = {
      source: 'exa' as const,
      query: 'Demorondanga Bar, Montevideo, Uruguay',
      output: {
        content: {
          name: 'Demorondanga Bar',
          description: 'Un bar.',
          address: 'Ejemplo 123',
          contact_info: 'Teléfono',
          open_hours_raw: '18:00 a 01:00',
          open_hours: [{ days: 'Mon-Sun', opens: '18:00', closes: '01:00' }],
          knows_before_you_go: 'Reservar.',
          menu: ['Pizza'],
        },
        grounding: [],
      },
      results: [],
      requestId: 'exa-request-1',
      attribution: 'Exa',
    }
    const searchPlace = vi.fn().mockResolvedValue(exaResponse)
    const app = createApp({
      exaProvider: { configured: true, searchPlace },
    })

    const response = await app.request('/api/places/exa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  Demorondanga Bar  ' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(searchPlace).toHaveBeenCalledWith('Demorondanga Bar', { refresh: undefined })
    expect(await response.json()).toEqual(exaResponse)
  })

  it('valida y normaliza errores de Exa', async () => {
    const searchPlace = vi.fn().mockRejectedValue(
      new PlacesProviderError('quota', 'Exa limitó temporalmente las consultas.'),
    )
    const app = createApp({
      exaProvider: { configured: true, searchPlace },
    })

    const invalid = await app.request('/api/places/exa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    const limited = await app.request('/api/places/exa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Demorondanga Bar' }),
    })

    expect(invalid.status).toBe(400)
    expect(searchPlace).toHaveBeenCalledTimes(1)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toEqual({
      error: { code: 'QUOTA_ERROR', message: 'Exa limitó temporalmente las consultas.' },
    })
  })

  it('informa la disponibilidad sin exponer configuración', async () => {
    const response = await createApp({
      provider: { search: vi.fn() },
      matchProviders: {
        overture: {
          source: 'overture',
          attribution: 'Overture',
          configured: true,
          findCandidates: vi.fn(),
        },
      },
    }).request('/api/health')

    expect(await response.json()).toEqual({
      status: 'ok',
      sources: {
        google: true,
        exa: false,
        overture: true,
        openstreetmap: false,
        instagram: false,
        placeExtraction: false,
        neighborhoodSweep: false,
      },
    })
  })
})

describe('POST /api/neighborhoods/:neighborhoodId/sweep', () => {
  const readEvents = async (response: Response) =>
    (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

  it('informa cuando falta la clave de Google', async () => {
    const response = await createApp().request('/api/neighborhoods/POCITOS/sweep', { method: 'POST' })
    expect(response.status).toBe(503)
  })

  it('rechaza barrios fuera del catálogo antes de barrer', async () => {
    const sweep = vi.fn()
    const response = await createApp({ sweeper: { maxCalls: 10, sweep } }).request('/api/neighborhoods/OTRA%20CIUDAD/sweep', { method: 'POST' })
    expect(response.status).toBe(400)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('transmite lugares y resumen en NDJSON', async () => {
    const place = {
      placeId: 'p1', name: 'Bar Uno', type: 'Bar', googleMapsUri: 'https://maps.google.com/p1',
      seedCategories: ['bar' as const], googleTypes: ['bar'], foundBy: ['bar:bar'], insideNeighborhood: true,
      group: 'accepted' as const, reason: null, primaryType: 'bar', rating: 4.5, userRatingCount: 120,
    }
    const summary = {
      neighborhoodId: 'PARQUE RODO', mode: 'full' as const, totalPlaces: 1, bySeedCategory: { bar: 1 }, byGroup: { accepted: 1, review: 0, rejected: 0 }, byReason: {}, unknownTypes: {}, newByQuery: { 'bar:bar': 1 },
      saturatedCells: [], discardedOutside: 0, apiCalls: { sweep: 1, rescue: 0 }, failedCalls: [], failedCallCount: 0, failedPageCount: 0, truncated: false, maxCalls: 10,
    }
    const sweep = vi.fn(async (_id: string, options: { onEvent?: (event: unknown) => void } = {}) => {
      options.onEvent?.({ type: 'places', items: [place] })
      return { places: [place], summary }
    })
    const response = await createApp({ sweeper: { maxCalls: 10, sweep } }).request('/api/neighborhoods/PARQUE%20RODO/sweep', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(sweep).toHaveBeenCalledWith('PARQUE RODO', expect.objectContaining({ mode: 'full', signal: expect.any(AbortSignal) }))
    expect(await readEvents(response)).toEqual([
      { type: 'places', items: [place] },
      { type: 'done', summary },
    ])
  })

  it('acepta el modo sólo IDs y rechaza modos desconocidos', async () => {
    const sweep = vi.fn().mockResolvedValue({ places: [], summary: {} })
    const app = createApp({ sweeper: { maxCalls: 10, sweep } })
    const post = (body: unknown) => app.request('/api/neighborhoods/POCITOS/sweep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const ids = await post({ mode: 'ids' })
    await ids.text()
    const invalid = await post({ mode: 'todo' })

    expect(ids.status).toBe(200)
    expect(sweep).toHaveBeenCalledTimes(1)
    expect(sweep).toHaveBeenCalledWith('POCITOS', expect.objectContaining({ mode: 'ids' }))
    expect(invalid.status).toBe(400)
  })

  it('cierra el stream con un error normalizado', async () => {
    const sweep = vi.fn().mockRejectedValue(new PlacesProviderError('authorization', 'Google Places rechazó las credenciales configuradas.'))
    const response = await createApp({ sweeper: { maxCalls: 10, sweep } }).request('/api/neighborhoods/POCITOS/sweep', { method: 'POST' })
    expect(await readEvents(response)).toEqual([
      { type: 'error', error: { code: 'AUTHORIZATION_ERROR', message: 'Google Places rechazó las credenciales configuradas.' } },
    ])
  })
})
