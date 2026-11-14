import { describe, expect, it } from 'vitest'
import { createSwrCache } from '../swr'

/** Un reloj y una cola de tareas "después de responder" manejados a mano. */
function setup(maxAgeMs = 600_000) {
  let clock = 0
  const tasks: (() => Promise<void>)[] = []
  const errors: unknown[] = []
  const cache = createSwrCache<string>({ maxAgeMs, schedule: (task) => tasks.push(task), now: () => clock, onError: (error) => errors.push(error) })
  const flush = async () => {
    while (tasks.length) await tasks.shift()!()
  }
  return { cache, tasks, errors, flush, tick: (ms: number) => (clock += ms) }
}

describe('caché de las filas (stale-while-revalidate)', () => {
  it('sin entrada, se arma y se espera; varios pedidos a la vez comparten la misma carga', async () => {
    const { cache } = setup()
    let loads = 0
    const load = async () => `v${++loads}`
    const [a, b] = await Promise.all([cache.get('k', load), cache.get('k', load)])
    expect([a, b, loads]).toEqual(['v1', 'v1', 1])
  })

  it('vencida: devuelve lo cacheado sin esperar y la rearma en segundo plano una sola vez', async () => {
    const { cache, tasks, flush, tick } = setup()
    let version = 0
    const load = async () => `v${++version}`
    await cache.get('k', load)
    tick(600_001)
    // Nadie espera: los dos pedidos reciben la vieja y hay una sola actualización pendiente.
    expect(await cache.get('k', load)).toBe('v1')
    expect(await cache.get('k', load)).toBe('v1')
    expect(tasks).toHaveLength(1)
    await flush()
    tick(1)
    expect(await cache.get('k', load)).toBe('v2')
    expect(tasks).toHaveLength(0)
  })

  it('antes de vencer no rearma', async () => {
    const { cache, tasks, tick } = setup()
    await cache.get('k', async () => 'v1')
    tick(599_999)
    expect(await cache.get('k', async () => 'v2')).toBe('v1')
    expect(tasks).toHaveLength(0)
  })

  it('si falla la actualización, sigue la anterior y se reintenta en el próximo pedido', async () => {
    const { cache, errors, flush, tick } = setup()
    await cache.get('k', async () => 'v1')
    tick(600_001)
    expect(await cache.get('k', async () => Promise.reject(new Error('neon')))).toBe('v1')
    await flush()
    expect(errors).toHaveLength(1)
    expect(await cache.get('k', async () => 'v2')).toBe('v1')
    await flush()
    expect(await cache.get('k', async () => 'v3')).toBe('v2')
  })

  it('precalentar arma la clave en segundo plano; el primer pedido de la franja nueva ya no espera', async () => {
    const { cache, tasks, flush } = setup()
    cache.warm('night', async () => 'noche')
    expect(tasks).toHaveLength(1)
    // Precalentar dos veces no arma dos veces.
    cache.warm('night', async () => 'otra')
    await flush()
    let waited = false
    expect(await cache.get('night', async () => ((waited = true), 'tarde'))).toBe('noche')
    expect(waited).toBe(false)
  })

  it('una clave nueva (otra franja) nunca devuelve la anterior, y se guardan sólo las dos últimas', async () => {
    const { cache } = setup()
    expect(await cache.get('2026-11-16|afternoon', async () => 'tarde')).toBe('tarde')
    expect(await cache.get('2026-11-16|night', async () => 'noche')).toBe('noche')
    await cache.get('2026-11-17|late', async () => 'trasnoche')
    expect(cache.keys()).toEqual(['2026-11-16|night', '2026-11-17|late'])
  })
})
