import { describe, expect, it, vi } from 'vitest'
import { fetchPlaceRefresh, REFRESH_FIELD_MASK } from '../google'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const googleError = (status: number, code: string, message: string) => json({ error: { code: status, status: code, message } }, status)

describe('fetchPlaceRefresh', () => {
  it('pide sólo location y movedPlaceId (Essentials), sin businessStatus (Pro)', async () => {
    const fetchFn = vi.fn(async () => json({ location: { latitude: -34.9, longitude: -56.16 } }))
    const result = await fetchPlaceRefresh('ChIJ/abc', 'clave', fetchFn)

    expect(result).toEqual({ kind: 'ok', lat: -34.9, lng: -56.16, movedPlaceId: null })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://places.googleapis.com/v1/places/ChIJ%2Fabc')
    expect(init.headers).toEqual({ 'X-Goog-Api-Key': 'clave', 'X-Goog-FieldMask': 'location,movedPlaceId' })
    expect(init.cache).toBe('no-store')
    expect(REFRESH_FIELD_MASK.split(',')).not.toContain('businessStatus')
  })

  it('trae movedPlaceId cuando Google reemplazó el lugar', async () => {
    const fetchFn = vi.fn(async () => json({ location: { latitude: 1, longitude: 2 }, movedPlaceId: 'ChIJnuevo' }))
    expect(await fetchPlaceRefresh('x', 'k', fetchFn)).toEqual({ kind: 'ok', lat: 1, lng: 2, movedPlaceId: 'ChIJnuevo' })
  })

  it('404 NOT_FOUND o 400 por un place_id inválido: no encontrado', async () => {
    const missing = vi.fn(async () => googleError(404, 'NOT_FOUND', 'Requested entity was not found.'))
    expect(await fetchPlaceRefresh('x', 'k', missing)).toEqual({ kind: 'not_found' })
    const invalid = vi.fn(async () => googleError(400, 'INVALID_ARGUMENT', 'Not a valid Place ID: x'))
    expect(await fetchPlaceRefresh('x', 'k', invalid)).toEqual({ kind: 'not_found' })
  })

  it('403, 401 y clave inválida cortan por autorización; 429 por cuota', async () => {
    const cases: [Response, string][] = [
      [googleError(403, 'PERMISSION_DENIED', 'Places API (New) has not been used'), 'authorization'],
      [googleError(401, 'UNAUTHENTICATED', 'no'), 'authorization'],
      [googleError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'), 'authorization'],
      [googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded'), 'quota'],
      [new Response('x', { status: 429 }), 'quota'],
    ]
    for (const [response, reason] of cases) {
      const result = await fetchPlaceRefresh('x', 'k', vi.fn(async () => response))
      expect(result).toMatchObject({ kind: 'stop', reason })
    }
  })

  it('5xx, otro 400, red caída o respuesta sin location: falla sin marcar el lugar', async () => {
    const results = await Promise.all([
      fetchPlaceRefresh('x', 'k', vi.fn(async () => new Response('<html>', { status: 502 }))),
      fetchPlaceRefresh('x', 'k', vi.fn(async () => googleError(400, 'INVALID_ARGUMENT', 'Invalid field mask'))),
      fetchPlaceRefresh('x', 'k', vi.fn(async () => Promise.reject(new Error('ECONNRESET')))),
      fetchPlaceRefresh('x', 'k', vi.fn(async () => json({}))),
    ])
    for (const result of results) expect(result.kind).toBe('error')
  })
})
