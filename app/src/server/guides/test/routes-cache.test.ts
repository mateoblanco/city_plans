import { describe, expect, it, vi } from 'vitest'
import { createGuideRoutesCache, GUIDE_ROUTES_MAX_AGE_MS } from '../routes-cache'
import { guideProxyAction } from '../routes'

const ROUTES = ['/guides/montevideo', '/guides/montevideo/cordon']

describe('lista de rutas del proxy (sin consulta por pedido)', () => {
  it('muchos pedidos, una sola consulta (también los que llegan a la vez en una instancia nueva)', async () => {
    const load = vi.fn().mockResolvedValue(ROUTES)
    const cache = createGuideRoutesCache({ load })
    const first = await Promise.all(Array.from({ length: 20 }, () => cache.routes()))
    for (let index = 0; index < 100; index++) await cache.routes()
    expect(load).toHaveBeenCalledTimes(1)
    expect(first.every(({ routes }) => routes?.has('/guides/montevideo/cordon'))).toBe(true)
    expect(first.every(({ background }) => background === null)).toBe(true)
  })

  it('vencida (más de un minuto): espera la lista nueva, una sola consulta para pedidos concurrentes', async () => {
    let now = 0
    const load = vi.fn().mockResolvedValueOnce(ROUTES).mockResolvedValueOnce([...ROUTES, '/guides/montevideo/nueva'])
    const cache = createGuideRoutesCache({ load, now: () => now })
    await cache.routes()
    now = GUIDE_ROUTES_MAX_AGE_MS + 1
    const fresh = await Promise.all([cache.routes(), cache.routes(), cache.routes()])
    expect(fresh.every(({ routes }) => routes?.has('/guides/montevideo/nueva'))).toBe(true)
    expect(fresh.every(({ background }) => background === null)).toBe(true)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('si la base falla sin lista: null (el proxy deja pasar) y se reintenta en el próximo pedido', async () => {
    const onError = vi.fn()
    const load = vi.fn().mockRejectedValueOnce(new Error('sin base')).mockResolvedValueOnce(ROUTES)
    const cache = createGuideRoutesCache({ load, onError })
    const failed = await cache.routes()
    expect(failed.routes).toBeNull()
    expect(guideProxyAction('/guides/montevideo/cordon', failed.routes).kind).toBe('next')
    expect(onError).toHaveBeenCalled()
    expect((await cache.routes()).routes?.size).toBe(2)
  })

  it('si falla al rearmar, deja pasar al handler para que confirme la ruta', async () => {
    let now = 0
    const load = vi.fn().mockResolvedValueOnce(ROUTES).mockRejectedValueOnce(new Error('sin base'))
    const cache = createGuideRoutesCache({ load, now: () => now, onError: () => {} })
    await cache.routes()
    now = GUIDE_ROUTES_MAX_AGE_MS + 1
    const failed = await cache.routes()
    expect(failed.routes).toBeNull()
  })

  it('una instancia nueva usa la lista de la Runtime Cache sin ir a la base', async () => {
    const store = { get: vi.fn().mockResolvedValue({ v: ROUTES, at: Date.now() }), set: vi.fn().mockResolvedValue(undefined) }
    const load = vi.fn()
    const cache = createGuideRoutesCache({ load, remote: store })
    expect((await cache.routes()).routes?.size).toBe(2)
    expect(load).not.toHaveBeenCalled()
  })
})
