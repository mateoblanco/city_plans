import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { EditError, type PlaceEditor } from './places/edit.ts'
import { NEIGHBORHOOD_IDS } from '../src/lib/getNeighborhood.ts'
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

  it('GET /api/places acepta ids (uuid, hasta 100) para la página del orden por puntaje', async () => {
    const list = vi.fn().mockResolvedValue({ places: [], total: 0, counts: { all: 0, published: 0, review: 0 } })
    const app = createApp({ placesReader: { list, neighborhoods: vi.fn(), setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion: vi.fn() } })
    const [a, b] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']

    expect((await app.request(`/api/places?ids=${b},${a},${b}&missing=price`)).status).toBe(200)
    expect(list).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, pageSize: 50, edited: false, missing: ['price'], ids: [b, a] })
    const tooMany = Array.from({ length: 101 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`).join(',')
    for (const query of ['ids=no-es-uuid', `ids=${a},x`, `ids=${tooMany}`]) {
      expect((await app.request(`/api/places?${query}`)).status, query).toBe(400)
    }
  })

  it('GET /api/places/neighborhoods: los barrios con lugares; 503 sin base y 500 si falla', async () => {
    const neighborhoods = vi.fn().mockResolvedValue([{ id: 'POCITOS', count: 123 }])
    const response = await createApp({ placesReader: { list: vi.fn(), neighborhoods, setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion: vi.fn() } }).request('/api/places/neighborhoods')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ neighborhoods: [{ id: 'POCITOS', count: 123 }] })
    expect((await createApp().request('/api/places/neighborhoods')).status).toBe(503)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = await createApp({ placesReader: { list: vi.fn(), neighborhoods: vi.fn().mockRejectedValue(new Error('boom')), setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion: vi.fn() } }).request('/api/places/neighborhoods')
    expect(failed.status).toBe(500)
    error.mockRestore()
  })

  it('GET /api/places/ids devuelve todos los filtrados en orden y los que no tienen Google Place ID', async () => {
    const filtered = vi.fn().mockResolvedValue([{ id: 'a', googlePlaceId: 'g-a' }, { id: 'b', googlePlaceId: null }])
    const app = createApp({ placeIds: { filtered, googleIds: vi.fn() } })

    const response = await app.request('/api/places/ids?missing=price,logo&price=unknown&status=review&sort=name')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ids: ['a', 'b'], withoutGoogleId: ['b'] })
    expect(filtered).toHaveBeenLastCalledWith({ sort: 'name', edited: false, missing: ['price', 'logo'], price: 'unknown', status: 'review' })
    expect((await app.request('/api/places/ids?missing=web')).status).toBe(400)
    expect((await createApp().request('/api/places/ids')).status).toBe(503)
  })

  it('POST /api/places/google-ratings: sólo pide a Google, parcial con 200, todos fallidos con el error de Google', async () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((char) => `${char.repeat(8)}-${char.repeat(4)}-4${char.repeat(3)}-8${char.repeat(3)}-${char.repeat(12)}`)
    const googleIds = vi.fn().mockResolvedValue([{ id: a, googlePlaceId: 'g-a' }, { id: b, googlePlaceId: 'g-b' }, { id: c, googlePlaceId: null }])
    const getRating = vi.fn(async (placeId: string) => {
      if (placeId === 'g-b') throw new PlacesProviderError('upstream', 'Google Places no respondió.')
      return { rating: 4.4, userRatingCount: 90 }
    })
    const placesReader = { list: vi.fn(), neighborhoods: vi.fn(), setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion: vi.fn() }
    const app = createApp({ provider: { search: vi.fn(), getRating }, placeIds: { filtered: vi.fn(), googleIds }, placesReader })
    const post = (body: unknown, target = app) => target.request('/api/places/google-ratings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    const response = await post({ ids: [a, b, c, d, a] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ratings: { [a]: { rating: 4.4, userRatingCount: 90 } }, failed: [{ id: b, message: 'Google Places no respondió.' }], skipped: 2 })
    expect(googleIds).toHaveBeenLastCalledWith([a, b, c, d])
    expect(getRating.mock.calls.map(([id]) => id)).toEqual(['g-a', 'g-b'])
    // No escribe: ni el reader ni nada más se toca.
    expect(placesReader.setFeatured).not.toHaveBeenCalled()
    expect(placesReader.publish).not.toHaveBeenCalled()

    const quota = createApp({
      provider: { search: vi.fn(), getRating: vi.fn().mockRejectedValue(new PlacesProviderError('quota', 'Se agotó la cuota de Google Places.')) },
      placeIds: { filtered: vi.fn(), googleIds: vi.fn().mockResolvedValue([{ id: a, googlePlaceId: 'g-a' }]) },
    })
    const failed = await post({ ids: [a] }, quota)
    expect(failed.status).toBe(429)
    expect(await failed.json()).toEqual({ error: { code: 'QUOTA_ERROR', message: 'Se agotó la cuota de Google Places.' } })

    for (const body of [{}, { ids: [] }, { ids: ['x'] }, { ids: Array.from({ length: 501 }, () => a) }]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 40)).toBe(400)
    }
    expect((await post({ ids: [a] }, createApp({ placeIds: { filtered: vi.fn(), googleIds } }))).status).toBe(503)
  })

  it('GET /api/places valida los filtros, pasa la página al reader y 500 si falla', async () => {
    const page = {
      places: [{
        id: 'uuid-1', name: 'El Palenque', neighborhoodId: 'CIUDAD VIEJA', categories: ['restaurant'], tags: ['cash_only'],
        status: 'published', hoursStatus: 'exact', updatedAt: '2026-10-12T15:00:00.000Z', hasEmbedding: true,
        prominence: 0.54, igFollowers: 999, featured: false, iconCategory: 'grill', editedFields: ['name'],
      }],
      total: 1,
      counts: { all: 1, published: 1, review: 0 },
    }
    const list = vi.fn().mockResolvedValue(page)
    const app = createApp({ placesReader: { list, neighborhoods: vi.fn(), setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion: vi.fn() } })

    const response = await app.request('/api/places')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual(page)
    expect(list).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, pageSize: 50, edited: false })

    const filtered = await app.request(`/api/places?q=%20palenque%20&neighborhood=${encodeURIComponent(NEIGHBORHOOD_IDS[0])}&category=bar&status=review&edited=1&sort=name&page=3&pageSize=20`)
    expect(filtered.status).toBe(200)
    expect(list).toHaveBeenLastCalledWith({ q: 'palenque', neighborhood: NEIGHBORHOOD_IDS[0], category: 'bar', status: 'review', edited: true, sort: 'name', page: 3, pageSize: 20 })

    await app.request('/api/places?missing=price,instagram,price&category=bar&status=review')
    expect(list).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, pageSize: 50, edited: false, missing: ['price', 'instagram'], category: 'bar', status: 'review' })

    await app.request('/api/places?price=moderate&category=bar')
    expect(list).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, pageSize: 50, edited: false, price: 'moderate', category: 'bar' })

    await app.request('/api/places?status=review&reason=low_rating')
    expect(list).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, pageSize: 50, edited: false, status: 'review', reason: 'low_rating' })

    await app.request('/api/places?priceSuggestion=1')
    expect(list).toHaveBeenLastCalledWith({ sort: 'recent', page: 1, pageSize: 50, edited: false, priceSuggestion: true })

    for (const query of ['category=bodegon', 'status=hidden', 'sort=rating', 'page=0', 'pageSize=500', 'neighborhood=Narnia', 'missing=web', 'missing=price,x', 'missing=,', 'reason=foo', 'reason=few_reviews', 'price=cheap', 'price=', 'price=very_high', 'priceSuggestion=yes']) {
      const invalid = await app.request(`/api/places?${query}`)
      expect(invalid.status, query).toBe(400)
    }

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = await createApp({ placesReader: { list: vi.fn().mockRejectedValue(new Error('boom')), neighborhoods: vi.fn(), setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion: vi.fn() } }).request('/api/places')
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudieron cargar los lugares.' } })
    error.mockRestore()
  })

  describe('edición de lugares', () => {
    const id = '0b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const plan = { changed: ['price'], steps: [{ id: 'column_only', label: 'Sólo se guardan los campos, sin recálculos', costUsd: 0 }], totalUsd: 0, instagramOwners: [] }
    const editor = (overrides: Partial<PlaceEditor> = {}): PlaceEditor => ({
      get: vi.fn(async (placeId: string) => placeId === id ? { id, name: 'El Palenque' } as never : null),
      plan: vi.fn(async () => plan as never),
      apply: vi.fn(async () => ({ place: { id } as never, warnings: [] })),
      uploadLogo: vi.fn(async () => ({ logo: { key: 'logos/x-0123abcd.webp' } as never, logoUrl: null, classificationUsd: 0.0002 })),
      delete: vi.fn(async () => ({ id, snapshot: null, brandKeys: [], logoKey: null, warnings: [] })),
      ...overrides,
    })
    const patch = (app: ReturnType<typeof createApp>, body: unknown, placeId = id) => app.request(`/api/places/${placeId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })

    it('GET /api/places/:id devuelve el lugar, 404 si no existe y 400 con un id inválido', async () => {
      const app = createApp({ placeEditor: editor() })
      expect(await (await app.request(`/api/places/${id}`)).json()).toEqual({ place: { id, name: 'El Palenque' } })
      expect((await app.request('/api/places/1b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c')).status).toBe(404)
      expect((await app.request('/api/places/no-es-uuid')).status).toBe(400)
      expect((await createApp().request(`/api/places/${id}`)).status).toBe(503)
    })

    it('PATCH con dryRun devuelve el plan; sin dryRun guarda; valida contra los catálogos', async () => {
      const placeEditor = editor()
      const app = createApp({ placeEditor })

      const dry = await patch(app, { edit: { price: 'low' }, dryRun: true })
      expect(await dry.json()).toEqual({ plan })
      expect(placeEditor.apply).not.toHaveBeenCalled()

      const saved = await patch(app, { edit: { price: 'low', tags: ['terrace'] }, confirmSharedInstagram: true })
      expect(saved.status).toBe(200)
      expect(placeEditor.apply).toHaveBeenCalledWith(id, { price: 'low', tags: ['terrace'] }, { confirmSharedInstagram: true })

      for (const edit of [{ tags: ['no_existe'] }, { style: 'lujoso' }, { iconCategory: 'other' }, { price: 'barato' }, { instagram: '@Con Espacios' },
        { website: 'ftp://x.uy' }, { brandKey: 'Con Mayúsculas' }, { name: '' }, { slug: 'x' }]) {
        expect((await patch(app, { edit })).status, JSON.stringify(edit)).toBe(400)
      }
      expect((await patch(app, { edit: {} }, 'no-es-uuid')).status).toBe(400)
      expect((await createApp().request(`/api/places/${id}`, { method: 'PATCH', body: '{"edit":{}}' })).status).toBe(503)
    })

    it('PATCH traduce los errores de la edición: Instagram de otro lugar (con los dueños), perfil inexistente, Apify', async () => {
      const owners = [{ id: 'uuid-2', name: 'El Palenque Pocitos', neighborhoodId: 'pocitos', brandKey: null }]
      const failing = (error: Error) => createApp({ placeEditor: editor({ apply: vi.fn().mockRejectedValue(error) }) })

      const inUse = await patch(failing(new EditError('INSTAGRAM_IN_USE', 409, '@palenque.uy ya está en El Palenque Pocitos.', owners)), { edit: { instagram: 'palenque.uy' } })
      expect(inUse.status).toBe(409)
      expect(await inUse.json()).toEqual({ error: { code: 'INSTAGRAM_IN_USE', message: '@palenque.uy ya está en El Palenque Pocitos.' }, owners })
      expect((await patch(failing(new EditError('INSTAGRAM_NOT_FOUND', 422, 'No existe.')), { edit: { instagram: 'x' } })).status).toBe(422)
      expect((await patch(failing(new EditError('INSTAGRAM_PROVIDER_ERROR', 502, 'Apify.')), { edit: { instagram: 'x' } })).status).toBe(502)

      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const unknown = await patch(failing(new Error('boom')), { edit: { price: 'low' } })
      expect(await unknown.json()).toEqual({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo guardar la edición.' } })
      error.mockRestore()
    })

    // El archivo va como cuerpo crudo con su tipo.
    const rawImage = (file: { type: string; body: Uint8Array<ArrayBuffer> } | null): RequestInit => ({
      method: 'POST',
      headers: file ? { 'Content-Type': file.type } : {},
      body: file?.body,
    })

    it('POST /api/places/:id/logo acepta una imagen y rechaza lo demás', async () => {
      const placeEditor = editor()
      const app = createApp({ placeEditor })
      const upload = (file: Parameters<typeof rawImage>[0]) => app.request(`/api/places/${id}/logo`, rawImage(file))

      const ok = await upload({ type: 'image/png', body: new Uint8Array([1, 2, 3]) })
      expect(ok.status).toBe(200)
      expect(placeEditor.uploadLogo).toHaveBeenCalledWith(id, Buffer.from([1, 2, 3]), 'image/png')
      expect((await upload({ type: 'text/plain', body: new Uint8Array([1]) })).status).toBe(400)
      expect((await upload(null)).status).toBe(400)

      const invalid = createApp({ placeEditor: editor({ uploadLogo: vi.fn().mockRejectedValue(new EditError('LOGO_INVALID', 422, 'No se pudo usar el logo: la imagen mide menos de 150 px.')) }) })
      const small = await invalid.request(`/api/places/${id}/logo`, rawImage({ type: 'image/png', body: new Uint8Array([1]) }))
      expect(small.status).toBe(422)
      expect(await small.json()).toEqual({ error: { code: 'LOGO_INVALID', message: 'No se pudo usar el logo: la imagen mide menos de 150 px.' } })
    })

    it('DELETE /api/places/:id borra y devuelve qué limpió; 404 si no existe', async () => {
      const app = createApp({ placeEditor: editor() })
      expect(await (await app.request(`/api/places/${id}`, { method: 'DELETE' })).json()).toEqual({ id, snapshot: null, brandKeys: [], logoKey: null, warnings: [] })
      const missing = createApp({ placeEditor: editor({ delete: vi.fn().mockRejectedValue(new EditError('NOT_FOUND_ERROR', 404, 'El lugar no existe.')) }) })
      expect((await missing.request(`/api/places/${id}`, { method: 'DELETE' })).status).toBe(404)
      expect((await createApp().request(`/api/places/${id}`, { method: 'DELETE' })).status).toBe(503)
    })
  })

  it('PATCH /api/places/:id/featured valida el pedido y cambia sólo featured', async () => {
    const id = '0b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const setFeatured = vi.fn(async (placeId: string) => placeId === id)
    const app = createApp({ placesReader: { list: vi.fn(), neighborhoods: vi.fn(), setFeatured, publish: vi.fn(), dismissPriceSuggestion: vi.fn() } })
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
    const failing = createApp({ placesReader: { list: vi.fn(), neighborhoods: vi.fn(), setFeatured: vi.fn().mockRejectedValue(new Error('boom')), publish: vi.fn(), dismissPriceSuggestion: vi.fn() } })
    const failed = await failing.request(`/api/places/${id}/featured`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ featured: true }) })
    expect(failed.status).toBe(500)
    error.mockRestore()
    expect((await createApp().request(`/api/places/${id}/featured`, { method: 'PATCH', body: '{"featured":true}' })).status).toBe(503)
  })

  it('DELETE /api/places/:id/price-suggestion descarta la sugerencia sin tocar el precio', async () => {
    const id = '0b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const other = '1b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const dismissPriceSuggestion = vi.fn(async (placeId: string) => placeId === id)
    const app = createApp({ placesReader: { list: vi.fn(), neighborhoods: vi.fn(), setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion } })
    const remove = (placeId: string) => app.request(`/api/places/${placeId}/price-suggestion`, { method: 'DELETE' })

    const ok = await remove(id)
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ id, dismissed: true })
    expect(dismissPriceSuggestion).toHaveBeenCalledWith(id)
    expect((await remove('no-es-uuid')).status).toBe(400)
    expect((await remove(other)).status).toBe(404)

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = createApp({ placesReader: { list: vi.fn(), neighborhoods: vi.fn(), setFeatured: vi.fn(), publish: vi.fn(), dismissPriceSuggestion: vi.fn().mockRejectedValue(new Error('boom')) } })
    const failed = await failing.request(`/api/places/${id}/price-suggestion`, { method: 'DELETE' })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo descartar la sugerencia.' } })
    error.mockRestore()
    expect((await createApp().request(`/api/places/${id}/price-suggestion`, { method: 'DELETE' })).status).toBe(503)
  })

  it('PATCH /api/places/:id/status publica a mano un lugar en review', async () => {
    const id = '0b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const other = '1b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const published = '2b9f6a3c-1d2e-4f5a-8b7c-9d0e1f2a3b4c'
    const publish = vi.fn(async (placeId: string) => placeId === id ? 'published' as const : placeId === published ? 'not_in_review' as const : 'not_found' as const)
    const app = createApp({ placesReader: { list: vi.fn(), neighborhoods: vi.fn(), setFeatured: vi.fn(), publish, dismissPriceSuggestion: vi.fn() } })
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
    const failing = createApp({ placesReader: { list: vi.fn(), neighborhoods: vi.fn(), setFeatured: vi.fn(), publish: vi.fn().mockRejectedValue(new Error('boom')), dismissPriceSuggestion: vi.fn() } })
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
        coordinates: { lat: -34.906, lng: -56.202, source: 'google' as const, fetchedAt: '2026-10-01T00:00:00.000Z' },
        neighborhoodId: 'CIUDAD VIEJA',
        city: 'Montevideo' as const,
        googlePlaceId: 'place-1',
        transit: { status: 'success' as const, lines: [] },
        categories: ['cafe'], tags: [],
        dietary: { vegan: 'unknown' as const, vegetarian: 'unknown' as const, glutenFree: 'unknown' as const },
        price: 'unknown' as const, reservations: 'unknown' as const,
        hours: { raw: null, display: null, slots: [], status: 'none' as const, source: null }, contact: { instagram: null, website: null },
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

describe('descuentos', () => {
  const ourPlace = '00000000-0000-4000-8000-000000000001'
  const otherPlace = '00000000-0000-4000-8000-000000000002'

  async function service(options: { start?: () => string | null } = {}) {
    const { memoryDiscountStore } = await import('./discounts/memory-store.ts')
    const ours = [
      { id: ourPlace, name: 'Es Mercat', neighborhoodId: 'CIUDAD VIEJA', brandKey: null, instagram: null },
      { id: otherPlace, name: 'El Otro Es Mercat', neighborhoodId: 'CIUDAD VIEJA', brandKey: null, instagram: null },
    ]
    const store = memoryDiscountStore(ours)
    const { planDiscountWrites } = await import('./discounts/persist.ts')
    const sourcePlace = {
      id: 'bbva:es-mercat', providerId: 'bbva', sourceName: 'Es Mercat', category: null, city: 'Ciudad Vieja, Montevideo', departments: ['Montevideo'], montevideo: true,
      locations: [], website: null, instagram: null, sourceUrl: 'https://bank.test/es-mercat', logoUrl: null, description: null, sourceTags: [],
      campaign: { validFrom: null, validTo: null, text: null }, benefits: [],
    }
    await store.apply(planDiscountWrites({ providerId: 'bbva', runId: 'r1', now: new Date(), result: { places: [sourcePlace], unread: [] }, existing: [], candidates: ours }))
    // Itaú: el id lleva la ciudad (dos ":"), y un slug de BBVA con "%" (path codificado de la fuente).
    const itauPlace = { ...sourcePlace, id: 'itau:montevideo:dos-orientales', providerId: 'itau', sourceName: 'Dos Orientales', city: 'Montevideo', sourceUrl: 'https://bank.test/restaurantes.html' }
    await store.apply(planDiscountWrites({ providerId: 'itau', runId: 'r1', now: new Date(), result: { places: [itauPlace], unread: [] }, existing: [], candidates: ours }))
    const encodedPlace = { ...sourcePlace, id: 'bbva:caf%c3%a9-100%', sourceName: 'Café' }
    await store.apply(planDiscountWrites({ providerId: 'bbva', runId: 'r1', now: new Date(), result: { places: [sourcePlace, encodedPlace], unread: [] }, existing: [], candidates: ours }))
    const runner = { start: options.start ?? (() => 'r2'), status: () => ({ status: 'idle' }) }
    const discounts = { runner, store, candidates: async () => ours } as unknown as NonNullable<Parameters<typeof createApp>[0]>['discounts']
    return { app: createApp({ discounts }), store }
  }
  const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const at = '/api/discounts/places/bbva%3Aes-mercat'

  it('sin base responde 503', async () => {
    expect((await createApp().request('/api/discounts')).status).toBe(503)
    expect((await createApp().request('/api/discounts/runs', { method: 'POST' })).status).toBe(503)
  })

  it('GET /api/discounts devuelve lo guardado y la última corrida', async () => {
    const { app } = await service()
    const body = await (await app.request('/api/discounts')).json()
    expect(body.run).toBeNull()
    expect(body.places).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'bbva:es-mercat', match: expect.objectContaining({ status: 'found', origin: 'auto' }) })]))
  })

  it('POST /api/discounts/runs arranca la corrida (202) o avisa que ya hay una (409)', async () => {
    expect((await (await service()).app.request('/api/discounts/runs', { method: 'POST' })).status).toBe(202)
    const busy = await (await service({ start: () => null })).app.request('/api/discounts/runs', { method: 'POST' })
    expect(busy.status).toBe(409)
    expect((await busy.json()).error.code).toBe('DISCOUNT_RUN_IN_PROGRESS')
  })

  it('confirmar pasa el cruce a manual; sin vínculos es 409', async () => {
    const { app } = await service()
    const confirmed = await app.request(`${at}/confirm`, { method: 'POST' })
    expect((await confirmed.json()).place.match).toMatchObject({ origin: 'manual', links: [expect.objectContaining({ origin: 'manual' })] })
    await app.request(`${at}/links`, { method: 'PUT', ...json({ links: [] }) })
    expect((await app.request(`${at}/confirm`, { method: 'POST' })).status).toBe(409)
  })

  it('PUT links: uno o varios, valida uuid y que existan; vacío desvincula', async () => {
    const { app } = await service()
    const linked = await app.request(`${at}/links`, { method: 'PUT', ...json({ links: [{ placeId: ourPlace }, { placeId: otherPlace, wholeBrand: true }] }) })
    expect(linked.status).toBe(200)
    expect((await linked.json()).place.match).toMatchObject({ status: 'found', origin: 'manual', links: [expect.objectContaining({ placeId: ourPlace, wholeBrand: false }), expect.objectContaining({ placeId: otherPlace, wholeBrand: true })] })
    expect((await app.request(`${at}/links`, { method: 'PUT', ...json({ links: [{ placeId: 'nope' }] }) })).status).toBe(400)
    expect((await app.request(`${at}/links`, { method: 'PUT', ...json({ links: [{ placeId: '00000000-0000-4000-8000-00000000ffff' }] }) })).status).toBe(400)
    const cleared = await app.request(`${at}/links`, { method: 'PUT', ...json({ links: [] }) })
    expect((await cleared.json()).place.match).toMatchObject({ status: 'missing', origin: 'manual', links: [] })
    expect((await app.request('/api/discounts/places/bbva%3Anada/links', { method: 'PUT', ...json({ links: [] }) })).status).toBe(404)
  })

  describe('Itaú (id con ciudad): cada camino del diálogo', () => {
    // Lo que manda el cliente: encodeURIComponent del id.
    const itau = `/api/discounts/places/${encodeURIComponent('itau:montevideo:dos-orientales')}`

    it('vincular a mano "Dos Orientales" de Itaú guarda (antes: "Vínculos inválidos")', async () => {
      const { app } = await service()
      const response = await app.request(`${itau}/links`, { method: 'PUT', ...json({ links: [{ placeId: ourPlace, wholeBrand: false }] }) })
      expect(response.status).toBe(200)
      expect((await response.json()).place).toMatchObject({ id: 'itau:montevideo:dos-orientales', match: { origin: 'manual', status: 'found', links: [expect.objectContaining({ placeId: ourPlace })] } })
    })

    it('candidatos, varios lugares con toda la marca, desvincular uno y desvincular todo', async () => {
      const { app } = await service()
      const put = (links: unknown[]) => app.request(`${itau}/links`, { method: 'PUT', ...json({ links }) })
      const both = await put([{ placeId: ourPlace, wholeBrand: true }, { placeId: otherPlace, wholeBrand: true }])
      expect((await both.json()).place.match.links).toHaveLength(2)
      const one = await put([{ placeId: otherPlace, wholeBrand: true }])
      expect((await one.json()).place.match.links).toEqual([expect.objectContaining({ placeId: otherPlace, wholeBrand: true })])
      const none = await put([])
      expect((await none.json()).place.match).toMatchObject({ status: 'missing', origin: 'manual', links: [] })
    })

    it('confirmar, ignorar y volver a automático', async () => {
      const { app } = await service()
      expect((await app.request(`${itau}/ignored`, { method: 'PATCH', ...json({ ignored: true }) })).status).toBe(200)
      expect((await app.request(`${itau}/auto`, { method: 'POST' })).status).toBe(200)
      await app.request(`${itau}/links`, { method: 'PUT', ...json({ links: [{ placeId: ourPlace }] }) })
      expect((await app.request(`${itau}/confirm`, { method: 'POST' })).status).toBe(200)
    })

    it('un slug con "%" no se decodifica dos veces', async () => {
      const { app } = await service()
      const response = await app.request(`/api/discounts/places/${encodeURIComponent('bbva:caf%c3%a9-100%')}/links`, { method: 'PUT', ...json({ links: [] }) })
      expect(response.status).toBe(200)
      expect((await response.json()).place.id).toBe('bbva:caf%c3%a9-100%')
    })

    it('los errores dicen qué falló', async () => {
      const { app } = await service()
      const error = async (url: string, body: unknown) => (await (await app.request(url, { method: 'PUT', ...json(body) })).json()).error.message
      expect(await error(`${itau}/links`, { links: [{ placeId: ourPlace }, { placeId: 'nope' }] })).toBe('Vínculos inválidos: el lugar 2 de 2 no es un id de lugar nuestro (uuid): «nope».')
      expect(await error(`${itau}/links`, { links: [{ placeId: ourPlace, wholeBrand: 'sí' }] })).toBe('Vínculos inválidos: «toda la marca» del lugar 1 debe ser sí o no.')
      expect(await error(`${itau}/links`, { placeIds: [ourPlace] })).toBe('Vínculos inválidos: se espera { links: [{ placeId, wholeBrand? }] }.')
      expect(await error(`${itau}/links`, { links: Array.from({ length: 201 }, () => ({ placeId: ourPlace })) })).toBe('Vínculos inválidos: son 201 lugares y el máximo es 200.')
      expect(await error('/api/discounts/places/no%20vale/links', { links: [] })).toBe('El id del lugar del proveedor no es válido: «no vale».')
      expect(await error(`${itau}/links`, { links: [{ placeId: '00000000-0000-4000-8000-00000000ffff' }] })).toMatch(/ya no existe en nuestra base/)
    })
  })

  it('ignorar y volver a automático', async () => {
    const { app } = await service()
    const ignored = await app.request(`${at}/ignored`, { method: 'PATCH', ...json({ ignored: true }) })
    expect((await ignored.json()).place.ignored).toBe(true)
    expect((await app.request(`${at}/ignored`, { method: 'PATCH', ...json({ ignored: 'sí' }) })).status).toBe(400)
    await app.request(`${at}/links`, { method: 'PUT', ...json({ links: [{ placeId: otherPlace }] }) })
    const auto = await app.request(`${at}/auto`, { method: 'POST' })
    expect((await auto.json()).place.match).toMatchObject({ origin: 'auto', status: 'found', links: [expect.objectContaining({ placeId: ourPlace, origin: 'auto' })] })
  })
})
