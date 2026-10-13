import { describe, expect, it, vi } from 'vitest'
import { GooglePlacesProvider } from './google-places-provider.ts'
import { seedCategoryForFoodPlaceType } from '../../src/data/food-place-types.ts'

describe('GooglePlacesProvider', () => {
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
