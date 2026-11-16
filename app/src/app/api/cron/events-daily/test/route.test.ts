import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const runDailySummary = vi.fn()
vi.mock('@/server/events/summary', () => ({ runDailySummary }))

const { GET } = await import('../route')

const request = (authorization?: string) =>
  new NextRequest('http://localhost/api/cron/events-daily', { headers: authorization ? { authorization } : {} })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('/api/cron/events-daily', () => {
  it('sin CRON_SECRET o con otro valor: 401 sin tocar la base', async () => {
    expect((await GET(request('Bearer x'))).status).toBe(401)
    vi.stubEnv('CRON_SECRET', 'secreto')
    expect((await GET(request())).status).toBe(401)
    expect((await GET(request('Bearer otro'))).status).toBe(401)
    expect(runDailySummary).not.toHaveBeenCalled()
  })

  it('con el secret de Vercel: arma el resumen y limpia', async () => {
    vi.stubEnv('CRON_SECRET', 'secreto')
    runDailySummary.mockResolvedValue({ summarized: { from: '2026-11-12', to: '2026-11-14' }, deletedBefore: '2026-08-17' })
    const response = await GET(request('Bearer secreto'))
    expect(response.status).toBe(200)
    expect(runDailySummary).toHaveBeenCalledOnce()
  })

  it('si falla: 500', async () => {
    vi.stubEnv('CRON_SECRET', 'secreto')
    runDailySummary.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(request('Bearer secreto'))).status).toBe(500)
  })
})
