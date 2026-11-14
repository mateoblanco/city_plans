import { describe, expect, it } from 'vitest'
import type { RemoteStore } from '../../search/runtime-cache'
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

/** Una Runtime Cache falsa compartida entre "instancias" (cada createSwrCache es una instancia con su memoria). */
function sharedRemote({ delayMs = 0 } = {}) {
  const data = new Map<string, unknown>()
  const writes: string[] = []
  const store: RemoteStore = {
    get: (key) => new Promise((resolve) => setTimeout(() => resolve(data.has(key) ? structuredClone(data.get(key)) : null), delayMs)),
    set: async (key, value) => {
      writes.push(key)
      data.set(key, structuredClone(value))
    },
  }
  return { store, data, writes }
}

function instance(remote: ReturnType<typeof sharedRemote>, clock: { now: number }, timeoutMs = 300) {
  const tasks: (() => Promise<void>)[] = []
  const pending: Promise<unknown>[] = []
  const cache = createSwrCache<string>({
    maxAgeMs: 600_000,
    schedule: (task) => tasks.push(task),
    now: () => clock.now,
    remote: {
      store: remote.store,
      key: (key) => `home:rows:v1:test:${key}`,
      read: (value) => (typeof value === 'string' ? value : null),
      ttlSeconds: 21_600,
      timeoutMs,
      name: 'home-rows',
      tags: ['home-rows'],
      background: (promise) => void pending.push(promise),
    },
  })
  const flush = async () => {
    while (tasks.length) await tasks.shift()!()
    await Promise.all(pending)
  }
  return { cache, tasks, flush }
}

describe('caché de las filas: segunda capa en Vercel Runtime Cache', () => {
  it('una instancia nueva arranca con lo que armó otra, sin ir a la base', async () => {
    const clock = { now: 0 }
    const remote = sharedRemote()
    const a = instance(remote, clock)
    await a.cache.get('2026-11-16|night', async () => 'armado por A')
    await a.flush()
    expect(remote.writes).toEqual(['home:rows:v1:test:2026-11-16|night'])
    const b = instance(remote, clock)
    let loaded = false
    expect(await b.cache.get('2026-11-16|night', async () => ((loaded = true), 'armado por B'))).toBe('armado por A')
    expect(loaded).toBe(false)
    expect(b.tasks).toHaveLength(0)
  })

  it('lo de la remota vencido se sirve igual y se rearma atrás (y se vuelve a guardar)', async () => {
    const clock = { now: 0 }
    const remote = sharedRemote()
    const a = instance(remote, clock)
    await a.cache.get('k', async () => 'v1')
    await a.flush()
    clock.now = 600_001
    const b = instance(remote, clock)
    expect(await b.cache.get('k', async () => 'v2')).toBe('v1')
    expect(b.tasks).toHaveLength(1)
    await b.flush()
    expect(await b.cache.get('k', async () => 'v3')).toBe('v2')
    expect(remote.data.get('home:rows:v1:test:k')).toEqual({ v: 'v2', at: 600_001 })
  })

  it('al rearmar, si otra instancia ya actualizó la remota, usa esa sin ir a la base', async () => {
    const clock = { now: 0 }
    const remote = sharedRemote()
    const a = instance(remote, clock)
    const b = instance(remote, clock)
    await a.cache.get('k', async () => 'v1')
    await a.flush()
    await b.cache.get('k', async () => 'no')
    clock.now = 600_001
    // A rearma primero y guarda v2.
    await a.cache.get('k', async () => 'v2')
    await a.flush()
    // B también está vencida: al rearmar encuentra v2 al día en la remota.
    let loaded = false
    expect(await b.cache.get('k', async () => ((loaded = true), 'v3'))).toBe('v1')
    await b.flush()
    expect(loaded).toBe(false)
    expect(await b.cache.get('k', async () => 'v4')).toBe('v2')
  })

  it('remota lenta, caída o con algo inválido: cuenta como que no estaba y se arma', async () => {
    const clock = { now: 0 }
    const slow = sharedRemote({ delayMs: 50 })
    slow.data.set('home:rows:v1:test:k', { v: 'viejo', at: 0 })
    expect(await instance(slow, clock, 10).cache.get('k', async () => 'armado')).toBe('armado')

    const broken = sharedRemote()
    broken.store.get = async () => {
      throw new Error('caída')
    }
    expect(await instance(broken, clock).cache.get('k', async () => 'armado')).toBe('armado')

    const invalid = sharedRemote()
    invalid.data.set('home:rows:v1:test:k', { v: 42, at: 0 })
    invalid.data.set('home:rows:v1:test:j', 'sin forma')
    const c = instance(invalid, clock).cache
    expect(await c.get('k', async () => 'armado')).toBe('armado')
    expect(await c.get('j', async () => 'armado')).toBe('armado')
  })

  it('la memoria no crece: un día entero de franjas deja sólo las dos últimas claves', async () => {
    const clock = { now: 0 }
    const { cache } = instance(sharedRemote(), clock)
    for (const day of ['2026-11-16', '2026-11-17', '2026-11-18']) {
      for (const slot of ['late', 'morning', 'midday', 'afternoon', 'night']) {
        await cache.get(`${day}|${slot}`, async () => slot)
        cache.warm(`${day}|next`, async () => 'siguiente')
      }
    }
    expect(cache.keys().length).toBeLessThanOrEqual(2)
  })
})

