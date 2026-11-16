import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const recordEvent = vi.fn()
const pending: Array<() => Promise<void>> = []
vi.mock('@/server/events/record', () => ({ recordEvent }))
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => pending.push(task),
}))

const { POST } = await import('../route')

const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 Version/17.1 Mobile/15E148 Safari/604.1'
const PLACE = '3f2b8c1e-2a4d-4c6b-9e8f-1a2b3c4d5e6f'
const body = { placeId: PLACE, type: 'view', origin: 'home', row: 'breakfast' }

function request(payload: unknown = body, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/events', {
    method: 'POST',
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    headers: { 'user-agent': BROWSER, 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'content-type': 'text/plain', ...headers },
  })
}

const flush = async () => {
  for (const task of pending.splice(0)) await task()
}

beforeEach(() => vi.stubEnv('TRACK_EVENTS', 'true'))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  pending.length = 0
})

describe('/api/events', () => {
  it('apagado (sin TRACK_EVENTS, como en desarrollo y previews): 204 sin guardar nada', async () => {
    for (const value of [undefined, 'false', '']) {
      vi.stubEnv('TRACK_EVENTS', value)
      const response = await POST(request())
      expect(response.status).toBe(204)
    }
    await flush()
    expect(pending).toEqual([])
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('prendido: 204 enseguida y guarda después de la respuesta, con la primera IP y sin cookies', async () => {
    const response = await POST(request())
    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(recordEvent).not.toHaveBeenCalled()
    await flush()
    expect(recordEvent).toHaveBeenCalledWith(
      { placeId: PLACE, type: 'view', origin: 'home', row: 'breakfast' },
      { ip: '203.0.113.9', userAgent: BROWSER },
    )
  })

  it('bots (por user agent) y pedidos de otro sitio: 204 sin guardar', async () => {
    await POST(request(body, { 'user-agent': 'Googlebot/2.1' }))
    await POST(request(body, { 'user-agent': '' }))
    await POST(request(body, { 'sec-fetch-site': 'cross-site' }))
    await flush()
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('body inválido: 400 sin guardar (ni texto de búsqueda ni campos de más)', async () => {
    for (const payload of [
      'no es json',
      { ...body, placeId: 'x' },
      { ...body, type: 'like' },
      { ...body, origin: 'ads' },
      { ...body, row: 'Con Espacios y Mayúsculas' },
      { ...body, row: 'a'.repeat(41) },
    ]) {
      const response = await POST(request(payload))
      expect(response.status, JSON.stringify(payload)).toBe(400)
    }
    await flush()
    expect(recordEvent).not.toHaveBeenCalled()
  })

  it('descarta campos que no son del evento (p. ej. una consulta)', async () => {
    await POST(request({ ...body, q: 'pizza en pocitos' }))
    await flush()
    expect(recordEvent.mock.calls[0][0]).not.toHaveProperty('q')
  })

  it('si falla la base, se pierde sin romper (y sin loguear la IP)', async () => {
    recordEvent.mockRejectedValue(new Error('timeout'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(request())).status).toBe(204)
    await flush()
    expect(JSON.stringify(error.mock.calls)).not.toContain('203.0.113.9')
  })
})
