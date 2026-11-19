import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getPublishedGooglePlaceId = vi.fn<(id: string) => Promise<string | null>>(async () => 'ChIJ-google')
const fetchPlaceDetails = vi.fn()
vi.mock('@/server/places/place', () => ({ getPublishedGooglePlaceId }))
vi.mock('@/server/places/google', async (original) => ({
  ...(await original<typeof import('@/server/places/google')>()),
  fetchPlaceDetails,
}))

const { GET } = await import('../route')

const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1'
const PLACE = '3f2b8c1e-2a4d-4c6b-9e8f-1a2b3c4d5e6f'
const DETAILS = {
  rating: 4.4,
  userRatingCount: 1230,
  googleMapsLinks: { reviewsUri: 'https://www.google.com/maps/place/reviews' },
  regularOpeningHours: { openNow: true, periods: [{ open: { day: 1, hour: 12 }, close: { day: 1, hour: 15 } }] },
  shortFormattedAddress: 'Sarmiento 1345, Montevideo',
  websiteUri: 'https://ejemplo.uy',
  internationalPhoneNumber: '+598 99 123 456',
}

function call(headers: Record<string, string> = {}, id = PLACE) {
  const request = new NextRequest(`http://localhost/api/place-google/${id}`, { headers: { 'user-agent': BROWSER, ...headers } })
  return GET(request, { params: Promise.resolve({ id }) })
}

const expectEmpty = (response: Response) => {
  expect(response.status).toBe(204)
  expect(response.headers.get('cache-control')).toBe('no-store, private')
  expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
}

afterEach(() => vi.clearAllMocks())

describe('/api/place-google/[id]', () => {
  it('un navegador: una sola llamada a Place Details con el field mask de siempre y sólo lo que muestra la ficha', async () => {
    fetchPlaceDetails.mockResolvedValueOnce({ ok: true, data: DETAILS })
    const response = await call({ 'sec-fetch-site': 'same-origin' })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
    expect(fetchPlaceDetails).toHaveBeenCalledTimes(1)
    // Sin field mask propio: el de siempre (DETAILS_FIELD_MASK, el valor por defecto).
    expect(fetchPlaceDetails).toHaveBeenCalledWith('ChIJ-google')
    expect(getPublishedGooglePlaceId).toHaveBeenCalledWith(PLACE)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['address', 'openNow', 'rating', 'ratingCount', 'reviewsHref', 'website', 'week', 'whatsappHref'])
    expect(body).toMatchObject({
      rating: 4.4,
      ratingCount: 1230,
      openNow: true,
      address: 'Sarmiento 1345',
      website: 'https://ejemplo.uy/',
      whatsappHref: 'https://wa.me/59899123456',
    })
  })

  it('un bot conocido (o sin user agent): 204 vacío, sin buscar el lugar ni llamar a Google', async () => {
    const bots = [
      'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'facebookexternalhit/1.1',
      'curl/8.4.0',
      '',
    ]
    for (const ua of bots) expectEmpty(await call({ 'user-agent': ua }))
    expect(getPublishedGooglePlaceId).not.toHaveBeenCalled()
    expect(fetchPlaceDetails).not.toHaveBeenCalled()
  })

  it('desde otro sitio: 204 sin llamar a Google', async () => {
    expectEmpty(await call({ 'sec-fetch-site': 'cross-site' }))
    expect(fetchPlaceDetails).not.toHaveBeenCalled()
  })

  it('id que no es de un lugar publicado con google_place_id: 204 sin llamar a Google', async () => {
    getPublishedGooglePlaceId.mockResolvedValueOnce(null)
    expectEmpty(await call({}, 'no-es-un-uuid'))
    getPublishedGooglePlaceId.mockRejectedValueOnce(new Error('sin base'))
    expectEmpty(await call())
    expect(fetchPlaceDetails).not.toHaveBeenCalled()
  })

  it('Google pasado de la cuota (429) o con error: 204 vacío, sin mensaje de error y sin reintentar', async () => {
    fetchPlaceDetails.mockResolvedValueOnce({ ok: false, error: 'Google respondió 429: Quota exceeded' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expectEmpty(await call())
    fetchPlaceDetails.mockResolvedValueOnce({ ok: false, error: 'No se pudo conectar con Google (timeout).' })
    expectEmpty(await call())
    expect(fetchPlaceDetails).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
