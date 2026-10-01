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

  it('extrae un borrador estructurado y valida el placeId', async () => {
    const result = {
      source: 'openai' as const,
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
        categories: ['cafe'], moments: [], cuisines: [], foods: [], drinks: [], features: [], goodFor: [],
        dietary: { vegan: 'unknown' as const, vegetarian: 'unknown' as const, glutenFree: 'unknown' as const },
        price: 'unknown' as const, reservations: 'unknown' as const, outdoorSeating: 'unknown' as const,
        hours: { raw: null, display: null, slots: [], status: 'none' as const, source: null }, contact: { phone: null, whatsapp: null, instagram: null, website: null, menuUrl: null, reservationUrl: null },
        highlights: [], description: { es: 'Un café.', en: 'A café.' }, searchText: 'Café Brasilero.',
      },
      attribution: 'Sitio web del local · Instagram vía Apify' as const,
    }
    const extract = vi.fn().mockResolvedValue(result)
    const app = createApp({ extractor: { configured: true, extract } })

    const request = { name: 'Café Brasilero', seedCategory: 'cafe' as const }
    const response = await app.request('/api/places/place-1/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
    const invalid = await app.request('/api/places/!/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
    const malformed = await app.request('/api/places/place-1/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Café Brasilero', refresh: 'yes' }),
    })
    const missingSeed = await app.request('/api/places/place-1/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Café Brasilero' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual(result)
    expect(extract).toHaveBeenCalledWith('place-1', request)
    expect(invalid.status).toBe(400)
    expect(malformed.status).toBe(400)
    expect(missingSeed.status).toBe(400)
  })

  it('informa cuando Vercel AI Gateway no está configurado', async () => {
    const response = await createApp().request('/api/places/place-1/extract', { method: 'POST' })
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
    const response = await app.request('/api/places/place-1/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Café Brasilero', seedCategory: 'cafe' }) })
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
      },
    })
  })
})
