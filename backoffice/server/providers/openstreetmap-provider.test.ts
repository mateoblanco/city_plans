import { describe, expect, it, vi } from 'vitest'
import { OpenStreetMapProvider } from './openstreetmap-provider.ts'

const anchor = {
  name: 'Café Brasilero',
  address: 'Ituzaingó 1447, Montevideo',
  latitude: -34.906,
  longitude: -56.202,
}

describe('OpenStreetMapProvider', () => {
  it('consulta tags sin metadata personal y reutiliza la caché', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        elements: [{
          type: 'node',
          id: 123,
          lat: -34.90601,
          lon: -56.20201,
          tags: {
            name: 'Café Brasilero',
            alt_name: 'Cafe Brasileiro;Brasilero Café',
            brand: 'Cafés del Uruguay',
            amenity: 'cafe',
            'addr:street': 'Ituzaingó',
            'addr:housenumber': '1447',
          },
        }],
      }), { status: 200 }),
    )
    const provider = new OpenStreetMapProvider({
      endpoint: 'https://overpass.test/api/interpreter',
      userAgent: 'CityPlansTest/1.0 (test@example.com)',
    }, fetcher)

    const first = await provider.findCandidates(anchor)
    const second = await provider.findCandidates(anchor)

    expect(first).toEqual(second)
    expect(first[0]).toMatchObject({
      name: 'Café Brasilero',
      alternativeNames: [
        'Cafe Brasileiro',
        'Brasilero Café',
        'Cafés del Uruguay',
      ],
      address: 'Ituzaingó 1447',
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [, init] = fetcher.mock.calls[0]
    expect(init.headers['User-Agent']).toContain('CityPlansTest')
    expect(String(init.body)).toContain('out+tags+center+qt')
    expect(String(init.body)).not.toContain('meta')
  })
})
