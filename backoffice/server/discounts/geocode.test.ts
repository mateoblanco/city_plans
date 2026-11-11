import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ideUyGeocoder, normalizeAddress, sameStreet, streetAndNumber } from './geocode.ts'
import { DISCOUNTS_USER_AGENT } from './polite-fetch.ts'

/** Respuestas reales de direcciones.ide.uy (noviembre 2026), por URL. */
const RECORDED = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'ide-uy.json'), 'utf8')) as Record<string, { status: number; body: unknown }>

function fakeIde(extra: Record<string, { status: number; body: unknown }> = {}) {
  const calls: { url: string; userAgent: string | null }[] = []
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, userAgent: new Headers(init?.headers).get('User-Agent') })
    const page = extra[url] ?? RECORDED[url]
    if (!page) return new Response('[]', { status: 200 })
    return new Response(typeof page.body === 'string' ? page.body : JSON.stringify(page.body), { status: page.status })
  }) as unknown as typeof globalThis.fetch
  return { fetch, calls }
}

describe('direcciones', () => {
  it('calle y número; esquinas, rutas, km y "SN" no se geocodifican', () => {
    expect(normalizeAddress('EDUARDO RAIZ1905')).toBe('EDUARDO RAIZ 1905')
    expect(streetAndNumber('PIEDRAS 284')).toEqual({ street: 'PIEDRAS', number: 284 })
    expect(streetAndNumber('HIPÓLITO YRIGOYEN 1728 BIS')).toEqual({ street: 'HIPÓLITO YRIGOYEN', number: 1728 })
    expect(streetAndNumber('ALEJO ROSSELL Y RIUS 1700')).toEqual({ street: 'ALEJO ROSSELL Y RIUS', number: 1700 })
    expect(streetAndNumber('EDUARDO RAIZ1905')).toEqual({ street: 'EDUARDO RAIZ', number: 1905 })
    for (const address of ['CALLE 1 CASI 22', 'CALLE 22 ENTRE 1 Y 11 SN', 'RUTA 8 KM 25,500', 'FERREIRA ESQUINA CENTRAL', 'CALLE 28 ESQ. GORLERO', 'RAMBLA Y ATANASIO SIERRA SN']) {
      expect(streetAndNumber(address)).toBeNull()
    }
  })

  it('la calle oficial puede tener más palabras; un alias sin palabras en común no es la misma calle', () => {
    expect(sameStreet('FRUGONI', 'DOCTOR EMILIO FRUGONI')).toBe(true)
    expect(sameStreet('ALEJO ROSSELL Y RIUS', 'ALEJO ROSELL Y RIUS')).toBe(true)
    expect(sameStreet('GARZÓN', 'AVENIDA GENERAL EUGENIO GARZON')).toBe(true)
    expect(sameStreet('YI', 'YI')).toBe(true)
    expect(sameStreet('YI', 'CARLOS QUIJANO')).toBe(false)
    expect(sameStreet('26 DE MARZO', '18 DE JULIO')).toBe(false)
  })
})

describe('ideUyGeocoder', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'geocode-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const piedras = { address: 'PIEDRAS 284', city: 'MONTEVIDEO', department: 'Montevideo' }

  it('dos pasos (candidatos y coordenadas), de a uno con pausa y user-agent genérico; la segunda vez, del cache', async () => {
    const ide = fakeIde()
    const sleeps: number[] = []
    let clock = 1_000
    const geocoder = ideUyGeocoder({ cacheDir: dir, fetch: ide.fetch, now: () => clock, sleep: async (ms) => { sleeps.push(ms); clock += ms } })
    const first = await geocoder.geocode(piedras)
    expect(first).toEqual({ hit: { lat: expect.closeTo(-34.90572, 4), lng: expect.closeTo(-56.21069, 4), matched: 'PIEDRAS 284' }, cached: false, reason: null })
    expect(ide.calls.map((call) => new URL(call.url).pathname)).toEqual(['/robots.txt', '/api/v1/geocode/candidates', '/api/v1/geocode/find'])
    expect(ide.calls.every((call) => call.userAgent === DISCOUNTS_USER_AGENT)).toBe(true)
    expect(sleeps).toEqual([1_000, 1_000])
    expect(geocoder.requests).toBe(3)

    const again = ideUyGeocoder({ cacheDir: dir, fetch: ide.fetch, offline: true })
    expect(await again.geocode(piedras)).toEqual({ ...first, cached: true })
    expect(again.requests).toBe(0)
  })

  it('sin red (reprocesar): lo que no está en el cache queda sin coordenadas', async () => {
    const ide = fakeIde()
    const geocoder = ideUyGeocoder({ cacheDir: dir, fetch: ide.fetch, offline: true })
    expect(await geocoder.geocode(piedras)).toMatchObject({ hit: null, cached: false, reason: expect.stringMatching(/cache/) })
    expect(ide.calls).toEqual([])
  })

  it('un número lejano o una calle con otro nombre no se usan (y el "no encontrado" también se cachea)', async () => {
    const ide = fakeIde()
    const geocoder = ideUyGeocoder({ cacheDir: dir, fetch: ide.fetch, delayMs: 0, sleep: async () => {} })
    // "ALFREDO BALDOMIR 2643": la IDE sólo tiene el 2498.
    expect(await geocoder.geocode({ address: 'ALFREDO BALDOMIR 2643', city: 'MONTEVIDEO', department: 'Montevideo' })).toMatchObject({ hit: null, reason: expect.stringMatching(/número lejano.*2498/) })
    // "YI 1411 BIS": la IDE propone Carlos Quijano (ex Yí) con otro número.
    expect(await geocoder.geocode({ address: 'YI 1411 BIS', city: 'MONTEVIDEO', department: 'Montevideo' })).toMatchObject({ hit: null, reason: expect.stringMatching(/otra calle.*QUIJANO/) })
    const requests = geocoder.requests
    expect(await geocoder.geocode({ address: 'YI 1411 BIS', city: 'MONTEVIDEO', department: 'Montevideo' })).toMatchObject({ hit: null, cached: true })
    expect(geocoder.requests).toBe(requests)
  })

  it('una esquina no hace ningún pedido; un candidato de otro departamento no cuenta', async () => {
    const ide = fakeIde({
      'https://direcciones.ide.uy/api/v1/geocode/candidates?q=PIEDRAS+284%2C+MONTEVIDEO&limit=5': {
        status: 200,
        body: [{ type: 'CALLEyPORTAL', idCalle: 1, nomVia: 'PIEDRAS', portalNumber: 284, departamento: 'CANELONES', address: 'PIEDRAS 284, LAS PIEDRAS', lat: 0, lng: 0 }],
      },
    })
    const geocoder = ideUyGeocoder({ cacheDir: dir, fetch: ide.fetch, delayMs: 0, sleep: async () => {} })
    expect(await geocoder.geocode({ address: 'CALLE 28 ESQ. GORLERO', city: 'MONTEVIDEO', department: 'Montevideo' })).toMatchObject({ hit: null, cached: false })
    expect(ide.calls).toEqual([])
    expect(await geocoder.geocode(piedras)).toMatchObject({ hit: null, reason: expect.stringMatching(/no encontró/) })
  })

  it('un 5xx o un timeout se reintenta una vez', async () => {
    let attempts = 0
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('robots.txt')) return new Response('', { status: 404 })
      if (url.includes('/candidates') && ++attempts === 1) throw new DOMException('timeout', 'TimeoutError')
      const page = RECORDED[url]
      return new Response(JSON.stringify(page?.body ?? []), { status: page?.status ?? 200 })
    }) as unknown as typeof globalThis.fetch
    const geocoder = ideUyGeocoder({ cacheDir: dir, fetch, delayMs: 0, sleep: async () => {} })
    expect((await geocoder.geocode(piedras)).hit?.matched).toBe('PIEDRAS 284')
    expect(attempts).toBe(2)
  })
})
