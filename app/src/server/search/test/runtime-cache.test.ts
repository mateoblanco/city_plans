import { describe, expect, it, vi } from 'vitest'
import type { SearchCache } from '../cache'
import { SEARCH_CONFIG } from '../config'
import { decodeEmbedding, embeddingKey, encodeEmbedding, interpretationKey, layeredCache, type RemoteStore } from '../runtime-cache'
import { llmOutput } from './fixtures'

const embedding = Array.from({ length: 1536 }, (_, i) => Math.sin(i) / 10)

/** Un base que cuenta las llamadas; fail hace que la próxima tire. */
function spyBase(options: { fail?: boolean; data?: unknown } = {}) {
  const calls = { interpret: 0, embed: 0 }
  const base: SearchCache = {
    async interpret() {
      calls.interpret++
      if (options.fail) throw new Error('timeout')
      return { data: (options.data ?? llmOutput()) as ReturnType<typeof llmOutput>, model: 'test-model', cost: 0.001, computedAt: Date.now() }
    },
    async embed() {
      calls.embed++
      if (options.fail) throw new Error('timeout')
      return { embedding, model: 'test-embedding', cost: 0.00001, computedAt: Date.now() }
    },
  }
  return { base, calls }
}

/** Runtime Cache compartido entre "instancias" (cada layeredCache es una instancia con su memoria). */
function fakeRemote(overrides: Partial<RemoteStore> = {}) {
  const entries = new Map<string, unknown>()
  const sets: { key: string; value: unknown; options: { ttl: number; tags: string[] } }[] = []
  let gets = 0
  const remote: RemoteStore = {
    async get(key) {
      gets++
      return entries.has(key) ? structuredClone(entries.get(key)) : null
    },
    async set(key, value, options) {
      // Como el real: se guarda serializado.
      entries.set(key, JSON.parse(JSON.stringify(value)))
      sets.push({ key, value, options })
    },
    ...overrides,
  }
  return { remote, entries, sets, gets: () => gets }
}

/** Las escrituras van en segundo plano: background las junta para esperarlas. */
function instance(base: SearchCache, remote: RemoteStore | null, options: Parameters<typeof layeredCache>[2] = {}) {
  const pending: Promise<unknown>[] = []
  const cache = layeredCache(base, remote, { background: (promise) => pending.push(promise), ...options })
  return { cache, flush: () => Promise.all(pending) }
}

describe('layeredCache', () => {
  it('miss: llama al modelo, guarda con TTL y tags; la misma instancia lo saca de memoria sin leer el remoto', async () => {
    const { base, calls } = spyBase()
    const store = fakeRemote()
    const { cache, flush } = instance(base, store.remote)
    const first = await cache.interpret('sushi en pocitos')
    await flush()
    expect(first.cacheSource).toBe('none')
    expect(store.sets).toHaveLength(1)
    expect(store.sets[0].options).toEqual({ ttl: SEARCH_CONFIG.cache.interpretationSeconds, tags: ['search-interpretation', `search-interpretation-v${SEARCH_CONFIG.interpretationCacheVersion}`], name: 'search-interpretation' })
    const gets = store.gets()
    const second = await cache.interpret('sushi en pocitos')
    expect(second.cacheSource).toBe('memory')
    expect(second.data).toEqual(first.data)
    expect(store.gets()).toBe(gets)
    expect(calls.interpret).toBe(1)
  })

  it('acierto remoto: otra instancia no llama al modelo ni al embedding', async () => {
    const store = fakeRemote()
    const cold = spyBase()
    const a = instance(cold.base, store.remote)
    await a.cache.interpret('sushi en pocitos')
    const original = await a.cache.embed('sushi en pocitos')
    await a.flush()

    const warm = spyBase()
    const b = instance(warm.base, store.remote)
    const interpretation = await b.cache.interpret('sushi en pocitos')
    const embedded = await b.cache.embed('sushi en pocitos')
    expect(warm.calls).toEqual({ interpret: 0, embed: 0 })
    expect(interpretation.cacheSource).toBe('remote')
    expect(interpretation.data).toEqual(llmOutput())
    expect(embedded.cacheSource).toBe('remote')
    // Float32 exacto: la primera búsqueda ya usa los valores redondeados, así que da igual que las de la cache.
    expect(embedded.embedding).toEqual(original.embedding)
    expect(embedded.embedding).toEqual(embedding.map(Math.fround))
  })

  it('el embedding se guarda como Float32 en base64 con el TTL largo', async () => {
    const store = fakeRemote()
    const { cache, flush } = instance(spyBase().base, store.remote)
    await cache.embed('pizza')
    await flush()
    const [{ value, options }] = store.sets as { value: { v: string }; options: { ttl: number; tags: string[] } }[]
    expect(options).toEqual({ ttl: SEARCH_CONFIG.cache.embeddingSeconds, tags: ['search-embedding'], name: 'search-embedding' })
    expect(value.v).toHaveLength(8192)
    expect(JSON.stringify(value).length).toBeLessThan(8300)
    expect(decodeEmbedding(value.v)).toEqual(embedding.map(Math.fround))
    expect(decodeEmbedding(encodeEmbedding([1, 2, 3]))).toEqual([1, 2, 3])
  })

  it('no guarda errores: la próxima vez vuelve a llamar', async () => {
    const store = fakeRemote()
    const failing = spyBase({ fail: true })
    const { cache, flush } = instance(failing.base, store.remote)
    await expect(cache.interpret('algo')).rejects.toThrow('timeout')
    await expect(cache.embed('algo')).rejects.toThrow('timeout')
    await flush()
    await expect(cache.interpret('algo')).rejects.toThrow('timeout')
    expect(failing.calls.interpret).toBe(2)
    expect(store.sets).toHaveLength(0)
  })

  it('no guarda una interpretación que no pasa el schema', async () => {
    const store = fakeRemote()
    const invalid = spyBase({ data: { must: 'cualquier cosa' } })
    const { cache, flush } = instance(invalid.base, store.remote)
    await expect(cache.interpret('algo')).rejects.toThrow('interpretación inválida')
    await flush()
    expect(store.sets).toHaveLength(0)
    await expect(cache.interpret('algo')).rejects.toThrow()
    expect(invalid.calls.interpret).toBe(2)
  })

  it('una entrada remota corrupta cuenta como miss y se reescribe', async () => {
    const store = fakeRemote()
    const version = SEARCH_CONFIG.interpretationCacheVersion
    store.entries.set(interpretationKey('algo', version, SEARCH_CONFIG.llm.model), { data: { roto: true }, model: 'x', computedAt: 1 })
    store.entries.set(embeddingKey('algo', SEARCH_CONFIG.embeddingModel), { v: 'abc', m: 'x', c: null, t: 1 })
    const { base, calls } = spyBase()
    const { cache, flush } = instance(base, store.remote)
    expect((await cache.interpret('algo')).cacheSource).toBe('none')
    expect((await cache.embed('algo')).cacheSource).toBe('none')
    await flush()
    expect(calls).toEqual({ interpret: 1, embed: 1 })
    expect(store.sets).toHaveLength(2)
  })

  it('sin remoto (local o fuera de Vercel): sólo memoria, sin romperse', async () => {
    const { base, calls } = spyBase()
    const { cache } = instance(base, null)
    expect((await cache.interpret('algo')).cacheSource).toBe('none')
    expect((await cache.interpret('algo')).cacheSource).toBe('memory')
    expect((await cache.embed('algo')).cacheSource).toBe('none')
    expect(calls).toEqual({ interpret: 1, embed: 1 })
  })

  it('si el remoto tira al leer o al escribir, la búsqueda sigue', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = fakeRemote({
      get: async () => {
        throw new Error('503')
      },
      set: async () => {
        throw new Error('503')
      },
    })
    const { base, calls } = spyBase()
    const { cache, flush } = instance(base, store.remote)
    expect((await cache.interpret('algo')).cacheSource).toBe('none')
    expect((await cache.embed('algo')).cacheSource).toBe('none')
    await flush()
    expect(calls).toEqual({ interpret: 1, embed: 1 })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('si el remoto tarda más que el timeout, se llama al modelo', async () => {
    vi.useFakeTimers()
    try {
      const store = fakeRemote({ get: () => new Promise(() => {}) })
      const { base, calls } = spyBase()
      const { cache } = instance(base, store.remote)
      const pending = cache.interpret('algo')
      await vi.advanceTimersByTimeAsync(SEARCH_CONFIG.cache.remoteTimeoutMs + 1)
      expect((await pending).cacheSource).toBe('none')
      expect(calls.interpret).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('una versión nueva de la interpretación no usa lo guardado con la anterior', async () => {
    const store = fakeRemote()
    const old = instance(spyBase().base, store.remote, { interpretationVersion: 9 })
    await old.cache.interpret('algo')
    await old.flush()
    const next = spyBase()
    const bumped = instance(next.base, store.remote, { interpretationVersion: 10 })
    expect((await bumped.cache.interpret('algo')).cacheSource).toBe('none')
    expect(next.calls.interpret).toBe(1)
    expect(interpretationKey('algo', 9, 'm')).not.toBe(interpretationKey('algo', 10, 'm'))
    await bumped.flush()
    // Lo guardado con la versión nueva sí lo usa otra instancia.
    const another = instance(spyBase().base, store.remote, { interpretationVersion: 10 })
    expect((await another.cache.interpret('algo')).cacheSource).toBe('remote')
  })

  it('otro modelo de interpretación tampoco acierta', () => {
    expect(interpretationKey('algo', 9, 'anthropic/a')).not.toBe(interpretationKey('algo', 9, 'anthropic/b'))
  })

  it('dos búsquedas iguales a la vez hacen una sola llamada', async () => {
    const { base, calls } = spyBase()
    const { cache } = instance(base, fakeRemote().remote)
    const [a, b] = await Promise.all([cache.embed('algo'), cache.embed('algo')])
    expect(calls.embed).toBe(1)
    expect([a.cacheSource, b.cacheSource]).toEqual(['none', 'memory'])
  })
})
