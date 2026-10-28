import { describe, expect, it, vi } from 'vitest'
import { DETAILS_FIELD_MASK, fetchPlaceDetails } from '../google'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('fetchPlaceDetails', () => {
  it('pide sólo los campos del field mask, con la clave del servidor y sin caché', async () => {
    const fetchFn = vi.fn(async () => json({ rating: 4.5 }))
    const result = await fetchPlaceDetails('ChIJ/abc', ' clave ', fetchFn)

    expect(result).toEqual({ ok: true, data: { rating: 4.5 } })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe('https://places.googleapis.com/v1/places/ChIJ%2Fabc?languageCode=es')
    expect(init.headers).toEqual({ 'X-Goog-Api-Key': 'clave', 'X-Goog-FieldMask': DETAILS_FIELD_MASK })
    expect(init.cache).toBe('no-store')
    expect(DETAILS_FIELD_MASK).toBe('rating,userRatingCount,regularOpeningHours,websiteUri,priceLevel,formattedAddress')
  })

  it('un error HTTP trae el mensaje de Google', async () => {
    const fetchFn = vi.fn(async () => json({ error: { message: 'API key not valid.', status: 'INVALID_ARGUMENT' } }, 400))
    expect(await fetchPlaceDetails('x', 'k', fetchFn)).toEqual({ ok: false, error: 'Google respondió 400: API key not valid.' })
  })

  it('red caída o cuerpo inválido no tiran', async () => {
    const down = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    expect(await fetchPlaceDetails('x', 'k', down)).toEqual({ ok: false, error: 'No se pudo conectar con Google (ECONNRESET).' })

    const html = vi.fn(async () => new Response('<html>', { status: 502 }))
    expect(await fetchPlaceDetails('x', 'k', html)).toEqual({ ok: false, error: 'Google respondió 502 con un cuerpo que no es JSON.' })
  })

  it('sin clave o sin place_id no llama a Google', async () => {
    const fetchFn = vi.fn(async () => json({}))
    expect(await fetchPlaceDetails('x', '  ', fetchFn)).toEqual({ ok: false, error: 'Falta configurar GOOGLE_PLACES_API_KEY.' })
    expect(await fetchPlaceDetails(null, 'k', fetchFn)).toEqual({ ok: false, error: 'El lugar no tiene google_place_id.' })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
