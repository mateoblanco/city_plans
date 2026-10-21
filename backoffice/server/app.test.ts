import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { DiscoveryExpired, ExaProviderFailure, InstagramNotFound, InstagramProviderFailure, PlacesProviderError, type PlacesProvider } from './providers/places-provider.ts'

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

  it('POST /api/places guarda los resultados y POST /api/places/exists devuelve los ya guardados', async () => {
    const saved = [{ googlePlaceId: 'place-1', id: 'uuid-1', action: 'created', embedded: true }]
    const placesSaver = { save: vi.fn().mockResolvedValue(saved), existing: vi.fn().mockResolvedValue(['place-1']) }
    const app = createApp({ placesSaver })
    const post = (body: unknown) => app.request('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const exists = (body: unknown) => app.request('/api/places/exists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const results = [{ status: 'ok', place: { googlePlaceId: 'place-1' } }, { status: 'error' }]

    const response = await post({ results })
    const found = await exists({ ids: ['place-1', ' place-2', 'place-1'] })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: saved })
    expect(placesSaver.save).toHaveBeenCalledWith(results)
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual({ ids: ['place-1'] })
    expect(placesSaver.existing).toHaveBeenCalledTimes(1)
    expect(placesSaver.existing).toHaveBeenCalledWith(['place-1', 'place-2'])
    // Un barrido grande entra en una sola consulta; más de 2000, vacío o ids vacíos no.
    const many = Array.from({ length: 2000 }, (_, index) => `place-${index}`)
    expect((await exists({ ids: many })).status).toBe(200)
    expect(placesSaver.existing).toHaveBeenLastCalledWith(many)
    expect((await exists({ ids: [...many, 'extra'] })).status).toBe(400)
    expect((await exists({ ids: [] })).status).toBe(400)
    expect((await exists({ ids: [''] })).status).toBe(400)
    expect((await exists(null)).status).toBe(400)
    expect((await post({ results: [] })).status).toBe(400)
    expect((await post({ results: [{ place: {} }] })).status).toBe(400)
    expect((await post(null)).status).toBe(400)
  })

  it('GET /api/places devuelve el listado del reader y 500 si falla', async () => {
    const list = [{
      id: 'uuid-1', name: 'El Palenque', neighborhoodId: 'CIUDAD VIEJA', categories: ['restaurant'], tags: ['cash_only'],
      status: 'published', hoursStatus: 'exact', updatedAt: '2026-10-12T15:00:00.000Z', hasEmbedding: true,
      prominence: 0.54, igFollowers: 999, featured: false, iconCategory: 'grill',
    }]
    const response = await createApp({ placesReader: { list: vi.fn().mockResolvedValue(list), setFeatured: vi.fn(), publish: vi.fn() } }).request('/api/places')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = await createApp({ placesReader: { list: vi.fn().mockRejectedValue(new Error('boom')), setFeatured: vi.fn(), publish: vi.fn() } }).request('/api/places')

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ places: list })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudieron cargar los lugares.' } })
    error.mockRestore()
  })

  it('PATCH /api/places/:id/featured valida el pedido y cambia sólo featured', async () => {
    const id = '0b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const setFeatured = vi.fn(async (placeId: string) => placeId === id)
    const app = createApp({ placesReader: { list: vi.fn(), setFeatured, publish: vi.fn() } })
    const patch = (placeId: string, body: unknown) => app.request(`/api/places/${placeId}/featured`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const ok = await patch(id, { featured: true })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ id, featured: true })
    expect(setFeatured).toHaveBeenCalledWith(id, true)

    expect((await patch('no-es-uuid', { featured: true })).status).toBe(400)
    expect((await patch(id, { featured: 'sí' })).status).toBe(400)
    expect((await patch(id, null)).status).toBe(400)
    const missing = await patch('1b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c', { featured: false })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ error: { code: 'NOT_FOUND_ERROR', message: 'El lugar no existe.' } })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = createApp({ placesReader: { list: vi.fn(), setFeatured: vi.fn().mockRejectedValue(new Error('boom')), publish: vi.fn() } })
    const failed = await failing.request(`/api/places/${id}/featured`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ featured: true }) })
    expect(failed.status).toBe(500)
    error.mockRestore()
    expect((await createApp().request(`/api/places/${id}/featured`, { method: 'PATCH', body: '{"featured":true}' })).status).toBe(503)
  })

  it('PATCH /api/places/:id/status publica a mano un lugar en review', async () => {
    const id = '0b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const other = '1b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const published = '2b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const publish = vi.fn(async (placeId: string) => placeId === id ? 'published' as const : placeId === published ? 'not_in_review' as const : 'not_found' as const)
    const app = createApp({ placesReader: { list: vi.fn(), setFeatured: vi.fn(), publish } })
    const patch = (placeId: string, body: unknown) => app.request(`/api/places/${placeId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const ok = await patch(id, { status: 'published' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ id, status: 'published' })
    expect(publish).toHaveBeenCalledWith(id)

    // Sólo se puede publicar: cualquier otro status es un pedido inválido.
    for (const body of [{ status: 'hidden' }, { status: 'review' }, { status: 'cualquiera' }, null]) {
      expect((await patch(id, body)).status).toBe(400)
    }
    expect((await patch('no-es-uuid', { status: 'published' })).status).toBe(400)
    expect(publish).toHaveBeenCalledTimes(1)
    expect((await patch(other, { status: 'published' })).status).toBe(404)
    const notInReview = await patch(published, { status: 'published' })
    expect(notInReview.status).toBe(409)
    expect(await notInReview.json()).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'El lugar no está para revisar.' } })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = createApp({ placesReader: { list: vi.fn(), setFeatured: vi.fn(), publish: vi.fn().mockRejectedValue(new Error('boom')) } })
    const failed = await failing.request(`/api/places/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'published' }) })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo publicar el lugar.' } })
    error.mockRestore()
    expect((await createApp().request(`/api/places/${id}/status`, { method: 'PATCH', body: '{"status":"published"}' })).status).toBe(503)
  })

  it('/api/places responde 503 si no hay base configurada', async () => {
    const app = createApp()
    const response = await app.request('/api/places', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [{ status: 'ok' }] }),
    })
    const exists = await app.request('/api/places/exists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['place-1'] }) })
    const list = await app.request('/api/places')

    expect(list.status).toBe(503)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar DATABASE_URL en .env.local.' } })
    expect(exists.status).toBe(503)
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
      'A revisar: 0',
      // Un lote de antes del logo: sin review.logo ni stats.logoUsd, valen los defaults.
      'Logos: 0 subidos · 1 sin foto usable · 0 con fallas',
      'Costo USD 0.2000: fuentes 0.1200 · LLM principal 0.0800 · segunda búsqueda 0.0000 · logo 0.0000',
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

  it('un error de Apify sale con su propio código, para que el lote lo cuente aparte', async () => {
    const app = createApp({
      extractor: { configured: true, extract: vi.fn().mockRejectedValue(new InstagramProviderFailure(new Error('Instagram demoró demasiado en responder.'))) },
    })
    const response = await app.request('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ googlePlaceId: 'place-1', seedCategories: ['cafe'] }) })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: { code: 'INSTAGRAM_PROVIDER_ERROR', message: 'Error de Apify: no se pudo consultar Instagram. Instagram demoró demasiado en responder.' },
    })
  })

  it('un error de Exa sale con su propio código, para que el lote lo cuente aparte', async () => {
    const app = createApp({
      extractor: { configured: true, extract: vi.fn().mockRejectedValue(new ExaProviderFailure(new Error('Exa no pudo completar la consulta.'))) },
    })
    const response = await app.request('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ googlePlaceId: 'place-1', seedCategories: ['cafe'] }) })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: { code: 'EXA_PROVIDER_ERROR', message: 'Error de Exa: no se pudo consultar Exa. Exa no pudo completar la consulta.' },
    })
  })

  it('procesa en dos pasos: descubre y completa con el Instagram elegido, validando el handle', async () => {
    const discovery = { googlePlaceId: 'place-1', status: 'doubtful', handle: 'cafebrasilero', doubt: 'name_only', candidates: [], costUsd: 0.04 }
    const discoverPlace = vi.fn().mockResolvedValue(discovery)
    const completePlace = vi.fn().mockResolvedValue({ source: 'llm', status: 'ok' })
    const app = createApp({ extractor: { configured: true, extract: vi.fn(), discoverPlace, completePlace } })
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    const discovered = await post('/api/extract/discover', { googlePlaceId: 'place-1', seedCategories: ['cafe'], neighborhoodId: 'CIUDAD VIEJA' })
    expect(discovered.status).toBe(200)
    expect(await discovered.json()).toEqual(discovery)
    expect(discoverPlace).toHaveBeenCalledWith('place-1', { seedCategories: ['cafe'], neighborhoodId: 'CIUDAD VIEJA' })
    expect((await post('/api/extract/discover', { googlePlaceId: 'place-1', seedCategories: ['otra'] })).status).toBe(400)

    for (const instagram of [{ mode: 'auto' }, { mode: 'manual', handle: 'cafe.brasilero_uy' }, { mode: 'none' }]) {
      expect((await post('/api/extract/complete', { googlePlaceId: 'place-1', instagram })).status).toBe(200)
    }
    expect(completePlace).toHaveBeenNthCalledWith(2, 'place-1', { mode: 'manual', handle: 'cafe.brasilero_uy' })
    for (const instagram of [{ mode: 'manual', handle: '@cafebrasilero' }, { mode: 'manual', handle: 'https://instagram.com/x' }, { mode: 'manual', handle: 'Cafe' }, { mode: 'otro' }, undefined]) {
      expect((await post('/api/extract/complete', { googlePlaceId: 'place-1', instagram })).status).toBe(400)
    }
    expect(completePlace).toHaveBeenCalledTimes(3)
  })

  it('el paso 2 avisa el handle inexistente (422) y el descubrimiento vencido (409); sin los pasos, 503', async () => {
    const completePlace = vi.fn()
      .mockRejectedValueOnce(new InstagramNotFound('cafe.brasilerro'))
      .mockRejectedValueOnce(new DiscoveryExpired())
    const app = createApp({ extractor: { configured: true, extract: vi.fn(), completePlace } })
    const complete = () => app.request('/api/extract/complete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ googlePlaceId: 'place-1', instagram: { mode: 'manual', handle: 'cafe.brasilerro' } }) })

    const notFound = await complete()
    expect(notFound.status).toBe(422)
    expect(await notFound.json()).toEqual({ error: { code: 'INSTAGRAM_NOT_FOUND', message: 'No existe el perfil @cafe.brasilerro en Instagram.' } })
    const expired = await complete()
    expect(expired.status).toBe(409)
    expect((await expired.json()).error.code).toBe('DISCOVERY_EXPIRED')
    expect((await app.request('/api/extract/discover', { method: 'POST' })).status).toBe(503)
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
      location: { lat: -34.91, lng: -56.16 }, containedIn: [],
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
