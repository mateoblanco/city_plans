import { describe, expect, it, vi } from 'vitest'
import { GooglePlacesProvider } from './google-places-provider.ts'
import { seedCategoryForFoodPlaceType } from '../../src/data/food-place-types.ts'

describe('GooglePlacesProvider', () => {
  it('findPlace: Text Search Pro (sin rating), sesgado a las coordenadas, sólo resultados con id, nombre y coordenadas', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      places: [
        { id: 'one', displayName: { text: 'La Pasiva' }, formattedAddress: 'Av. Brasil 2580, Montevideo', location: { latitude: -34.91, longitude: -56.15 }, primaryType: 'restaurant' },
        { id: 'no-location', displayName: { text: 'Sin lugar' } },
      ],
    }), { status: 200 }))
    const provider = new GooglePlacesProvider('private-key', fetcher)
    expect(await provider.findPlace({ query: 'La Pasiva, Av. Brasil 2580, Montevideo', near: { lat: -34.91, lng: -56.15 } })).toEqual([
      { placeId: 'one', name: 'La Pasiva', address: 'Av. Brasil 2580, Montevideo', lat: -34.91, lng: -56.15, primaryType: 'restaurant' },
    ])
    const init = (fetcher.mock.calls as unknown as [string, { headers: Record<string, string>; body: string }][])[0][1]
    const mask = init.headers['X-Goog-FieldMask']
    expect(mask.split(',').sort()).toEqual(['places.displayName', 'places.formattedAddress', 'places.id', 'places.location', 'places.primaryType'])
    expect(JSON.parse(init.body)).toMatchObject({ textQuery: 'La Pasiva, Av. Brasil 2580, Montevideo', pageSize: 5, locationBias: { circle: { center: { latitude: -34.91, longitude: -56.15 }, radius: 500 } } })
    await provider.findPlace({ query: 'Kamba, Montevideo' })
    expect(JSON.parse((fetcher.mock.calls as unknown as [string, { body: string }][])[1][1].body).locationBias.circle.radius).toBe(30000)
  })

  it('mapea tipos especializados de Google a la categoría semilla', () => {
    expect(seedCategoryForFoodPlaceType('pizza_restaurant')).toBe('pizzeria')
    expect(seedCategoryForFoodPlaceType('steak_house')).toBe('grill')
    expect(seedCategoryForFoodPlaceType('brewery')).toBe('brewery')
    expect(seedCategoryForFoodPlaceType('ramen_restaurant')).toBe('restaurant')
  })

  it('construye la búsqueda y normaliza lugares con fallback de tipo y enlace', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          places: [
            {
              id: 'one',
              displayName: { text: 'Bar Uno' },
              primaryTypeDisplayName: { text: 'Bar' },
              googleMapsUri: 'https://maps.google.com/one',
            },
            { id: 'two', displayName: { text: 'Bar Dos' } },
            { id: 'missing-name' },
          ],
          nextPageToken: 'next',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const provider = new GooglePlacesProvider('private-key', fetcher)

    const result = await provider.search({
      mode: 'filters',
      barrio: 'Pocitos',
      placeType: 'bar',
      pageToken: 'current',
    })

    expect(result).toEqual({
      items: [
        {
          placeId: 'one',
          name: 'Bar Uno',
          type: 'Bar',
          googleMapsUri: 'https://maps.google.com/one',
          seedCategories: ['bar'],
        },
        {
          placeId: 'two',
          name: 'Bar Dos',
          type: 'Bar',
          googleMapsUri:
            'https://www.google.com/maps/search/?api=1&query_place_id=two',
          seedCategories: ['bar'],
        },
      ],
      nextPageToken: 'next',
    })

    const [, init] = fetcher.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      textQuery: 'Bar en Pocitos, Montevideo, Uruguay',
      includedType: 'bar',
      strictTypeFiltering: true,
      languageCode: 'es',
      regionCode: 'UY',
      pageSize: 20,
      pageToken: 'current',
    })
    expect(init.headers['X-Goog-Api-Key']).toBe('private-key')
    expect(init.headers['X-Goog-FieldMask']).toBe(
      'places.id,places.displayName,places.primaryTypeDisplayName,places.googleMapsUri,nextPageToken',
    )
  })

  it('construye una búsqueda de texto libre enfocada en Montevideo', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ places: [] }), { status: 200 }),
    )
    const provider = new GooglePlacesProvider('private-key', fetcher)

    await provider.search({ mode: 'text', query: 'Café Brasilero', seedCategory: 'cafe' })

    const [, init] = fetcher.mock.calls[0]
    expect(JSON.parse(init.body as string)).toMatchObject({
      textQuery: 'Café Brasilero, Montevideo, Uruguay',
      locationBias: {
        circle: {
          center: { latitude: -34.9011, longitude: -56.1645 },
          radius: 30000,
        },
      },
    })
    expect(JSON.parse(init.body as string)).not.toHaveProperty('includedType')
  })

  it('obtiene todos los campos y deriva el ancla desde Place Details', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'place-1',
        displayName: { text: 'Café Brasilero' },
        formattedAddress: 'Ituzaingó 1447, Montevideo',
        location: { latitude: -34.906, longitude: -56.202 },
        websiteUri: 'https://cafebrasilero.com.uy/',
        primaryTypeDisplayName: { text: 'Cafetería' },
        rating: 4.7,
      }), { status: 200 }),
    )
    const provider = new GooglePlacesProvider('private-key', fetcher)

    const result = await provider.getDetails('place-1')

    expect(result.anchor).toEqual({
      name: 'Café Brasilero',
      address: 'Ituzaingó 1447, Montevideo',
      latitude: -34.906,
      longitude: -56.202,
    })
    expect(result.websiteUri).toBe('https://cafebrasilero.com.uy/')
    expect(result.placeType).toBe('Cafetería')
    await provider.getDetails('place-1')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toContain('/v1/places/place-1')
    expect(init.headers['X-Goog-FieldMask']).toBe('*')
  })

  it('getPlaceType pide sólo el tipo de lugar en español', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ primaryTypeDisplayName: { text: 'Restaurante' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const provider = new GooglePlacesProvider('private-key', fetcher)

    expect(await provider.getPlaceType('place-1')).toBe('Restaurante')
    expect(await provider.getPlaceType('place-2')).toBeNull()
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toContain('/v1/places/place-1?languageCode=es')
    expect(init.headers['X-Goog-FieldMask']).toBe('primaryTypeDisplayName')
  })

  it('getRating pide sólo rating y userRatingCount; sin dato, null', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ rating: 4.6, userRatingCount: 812 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
    const provider = new GooglePlacesProvider('private-key', fetcher)

    expect(await provider.getRating('place-1')).toEqual({ rating: 4.6, userRatingCount: 812 })
    expect(await provider.getRating('place-2')).toEqual({ rating: null, userRatingCount: null })
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://places.googleapis.com/v1/places/place-1')
    expect(init.headers['X-Goog-FieldMask']).toBe('rating,userRatingCount')
  })

  it('getBusinessStatus pide sólo businessStatus; 404 es NOT_FOUND y sin dato, null', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ businessStatus: 'CLOSED_TEMPORARILY' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'INTERNAL' } }), { status: 500 }))
    const provider = new GooglePlacesProvider('private-key', fetcher)

    expect(await provider.getBusinessStatus('place-1')).toBe('CLOSED_TEMPORARILY')
    expect(await provider.getBusinessStatus('place-2')).toBe('NOT_FOUND')
    expect(await provider.getBusinessStatus('place-3')).toBeNull()
    await expect(provider.getBusinessStatus('place-4')).rejects.toMatchObject({ kind: 'upstream' })
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('https://places.googleapis.com/v1/places/place-1')
    expect(init.headers['X-Goog-FieldMask']).toBe('businessStatus')
  })

  it.each([
    [403, 'PERMISSION_DENIED', 'authorization'],
    [429, 'RESOURCE_EXHAUSTED', 'quota'],
    [500, 'INTERNAL', 'upstream'],
  ] as const)('normaliza errores %s de Google', async (status, googleStatus, kind) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { status: googleStatus } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const provider = new GooglePlacesProvider('private-key', fetcher)

    await expect(
      provider.search({ mode: 'filters', barrio: 'Pocitos', placeType: 'restaurant' }),
    ).rejects.toMatchObject({ kind })
  })
})
