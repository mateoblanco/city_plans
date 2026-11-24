import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const runCoordinateRefresh = vi.fn()
vi.mock('@/server/places/refresh/run', () => ({ runCoordinateRefresh }))
vi.mock('@/server/events/record', () => ({ neonRun: vi.fn() }))

const { GET } = await import('../route')

const request = (authorization?: string) =>
  new NextRequest('http://localhost/api/cron/google-refresh', { headers: authorization ? { authorization } : {} })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('/api/cron/google-refresh', () => {
  it('sin CRON_SECRET o con otro valor: 401 sin llamar a Google ni a la base', async () => {
    expect((await GET(request('Bearer x'))).status).toBe(401)
    vi.stubEnv('CRON_SECRET', 'secreto')
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('Bearer otro'))).status).toBe(401)
    expect((await GET(request('secreto'))).status).toBe(401)
    expect(runCoordinateRefresh).not.toHaveBeenCalled()
  })

  it('con el secret de Vercel: corre el refresco con la clave del servidor', async () => {
    vi.stubEnv('CRON_SECRET', 'secreto')
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'clave')
    runCoordinateRefresh.mockResolvedValue({ refreshed: 40 })
    const response = await GET(request('Bearer secreto'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ refreshed: 40 })
    expect(runCoordinateRefresh).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'clave' }))
  })

  it('si falla: 500', async () => {
    vi.stubEnv('CRON_SECRET', 'secreto')
    runCoordinateRefresh.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(request('Bearer secreto'))).status).toBe(500)
  })
})
