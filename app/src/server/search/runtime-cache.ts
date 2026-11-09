import { createHash } from 'node:crypto'
import { SEARCH_CONFIG } from './config'
import type { CacheSource, EmbeddingResult, SearchCache } from './cache'
import { LlmInterpretationSchema } from './interpretation'
import type { LlmResult } from './llm'

/**
 * Cache de la interpretación y el embedding de una consulta en dos capas: memoria de la instancia y Vercel Runtime
 * Cache (compartido entre instancias y deploys, con claves propias que no dependen del build). Lo que no está en
 * ninguna se calcula y se guarda en las dos. Errores y respuestas inválidas no se guardan; si el remoto falla o
 * tarda, cuenta como que no estaba y la búsqueda sigue.
 */

/** Lo que se usa de getCache de @vercel/functions; en los tests, un fake. */
export type RemoteStore = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown, options: { ttl: number; tags: string[]; name: string }): Promise<void>
}

export type LayeredCacheOptions = {
  /** Para no frenar la respuesta con la escritura (waitUntil en Vercel). */
  background?: (promise: Promise<unknown>) => void
  interpretationVersion?: number
  llmModel?: string
  embeddingModel?: string
}

export const INTERPRETATION_TAG = 'search-interpretation'
export const EMBEDDING_TAG = 'search-embedding'

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')

/** La versión va legible (subirla invalida todo); modelo y texto, hasheados: la clave va en una URL. */
export const interpretationKey = (normalized: string, version: number, model: string) => `search:i:v${version}:${sha256(`${model}\n${normalized}`)}`
export const embeddingKey = (text: string, model: string) => `search:e:${sha256(`${model}\n${text}`)}`

/** El embedding en el remoto: Float32 en base64 (6 KB para 1536 dimensiones), no un array JSON de números (~30 KB). */
type StoredEmbedding = { v: string; m: string; c: number | null; t: number }

export function encodeEmbedding(embedding: number[]): string {
  return Buffer.from(new Float32Array(embedding).buffer).toString('base64')
}

export function decodeEmbedding(base64: string): number[] | null {
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0 || bytes.length % 4 !== 0) return null
  // Copia a un buffer propio: el de Buffer puede no estar alineado a 4 bytes.
  return Array.from(new Float32Array(new Uint8Array(bytes).buffer))
}

const validEmbedding = (embedding: unknown): embedding is number[] =>
  Array.isArray(embedding) && embedding.length > 0 && embedding.every((value) => typeof value === 'number' && Number.isFinite(value))

function validInterpretation(value: unknown): LlmResult | null {
  if (!value || typeof value !== 'object') return null
  const { data, model, cost, computedAt } = value as Record<string, unknown>
  const parsed = LlmInterpretationSchema.safeParse(data)
  if (!parsed.success || typeof model !== 'string' || typeof computedAt !== 'number') return null
  return { data: parsed.data, model, cost: typeof cost === 'number' ? cost : null, computedAt }
}

function storedEmbedding(value: unknown): EmbeddingResult | null {
  if (!value || typeof value !== 'object') return null
  const { v, m, c, t } = value as Partial<StoredEmbedding>
  if (typeof v !== 'string' || typeof m !== 'string' || typeof t !== 'number') return null
  const embedding = decodeEmbedding(v)
  return embedding && validEmbedding(embedding) ? { embedding, model: m, cost: typeof c === 'number' ? c : null, computedAt: t } : null
}

/** Memoria por instancia: guarda la promesa (dos búsquedas iguales a la vez hacen una sola llamada), con TTL y tope. */
class MemoryLayer<T> {
  private entries = new Map<string, { expires: number; value: Promise<T> }>()
  constructor(private ttlMs: number, private max: number) {}

  get(key: string): Promise<T> | null {
    const hit = this.entries.get(key)
    if (!hit) return null
    if (hit.expires <= Date.now()) {
      this.entries.delete(key)
      return null
    }
    // Map recuerda el orden de inserción: reinsertar la deja como la más reciente (LRU).
    this.entries.delete(key)
    this.entries.set(key, hit)
    return hit.value
  }

  set(key: string, value: Promise<T>) {
    this.entries.delete(key)
    this.entries.set(key, { expires: Date.now() + this.ttlMs, value })
    while (this.entries.size > this.max) this.entries.delete(this.entries.keys().next().value!)
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key)
    })
  }
}

const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T | null> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => (clearTimeout(timer), resolve(value)),
      () => (clearTimeout(timer), resolve(null)),
    )
  })

const warn = (what: string, error: unknown) => console.warn(`[search-cache] ${what}:`, error instanceof Error ? error.message : error)

export function layeredCache(base: SearchCache, remote: RemoteStore | null, options: LayeredCacheOptions = {}): SearchCache {
  const config = SEARCH_CONFIG.cache
  const background = options.background ?? ((promise: Promise<unknown>) => void promise)
  const interpretations = new MemoryLayer<LlmResult>(config.interpretationSeconds * 1000, config.memoryInterpretations)
  const embeddings = new MemoryLayer<EmbeddingResult>(config.embeddingSeconds * 1000, config.memoryEmbeddings)

  /** memoria → remoto → base. read valida lo que viene del remoto; store arma lo que se guarda. */
  function layered<T extends { cacheSource?: CacheSource }>(
    memory: MemoryLayer<T>,
    key: string,
    load: () => Promise<T>,
    read: (value: unknown) => T | null,
    write: { value: (result: T) => unknown; ttl: number; tags: string[]; name: string },
  ): Promise<T> {
    const hit = memory.get(key)
    if (hit) return hit.then((value) => ({ ...value, cacheSource: 'memory' as const }))
    const value = (async (): Promise<T> => {
      if (remote) {
        const stored = await withTimeout(Promise.resolve().then(() => remote.get(key)), config.remoteTimeoutMs)
        const result = stored === null || stored === undefined ? null : read(stored)
        if (result) return { ...result, cacheSource: 'remote' }
      }
      const result = await load()
      if (remote) {
        background(
          Promise.resolve()
            .then(() => remote.set(key, write.value(result), { ttl: write.ttl, tags: write.tags, name: write.name }))
            .catch((error: unknown) => warn(`no se pudo guardar ${write.name}`, error)),
        )
      }
      return { ...result, cacheSource: 'none' }
    })()
    memory.set(key, value)
    return value
  }

  return {
    interpret(normalized) {
      const version = options.interpretationVersion ?? SEARCH_CONFIG.interpretationCacheVersion
      const model = options.llmModel ?? SEARCH_CONFIG.llm.model
      return layered(
        interpretations,
        interpretationKey(normalized, version, model),
        async () => {
          // Lo que no pasa el schema no se guarda (generateText ya tira en ese caso; esto cubre otros base).
          const result = validInterpretation(await base.interpret(normalized))
          if (!result) throw new Error('interpretación inválida del modelo')
          return result
        },
        validInterpretation,
        {
          value: ({ data, model, cost, computedAt }) => ({ data, model, cost, computedAt }),
          ttl: SEARCH_CONFIG.cache.interpretationSeconds,
          tags: [INTERPRETATION_TAG, `${INTERPRETATION_TAG}-v${version}`],
          name: INTERPRETATION_TAG,
        },
      )
    },
    embed(text) {
      const model = options.embeddingModel ?? SEARCH_CONFIG.embeddingModel
      return layered(
        embeddings,
        embeddingKey(text, model),
        async () => {
          const result = await base.embed(text)
          if (!validEmbedding(result.embedding)) throw new Error('embedding inválido')
          // Redondeado a Float32 como lo que se guarda: la primera búsqueda y las que salen de la cache dan igual.
          return { ...result, embedding: result.embedding.map(Math.fround) }
        },
        storedEmbedding,
        {
          value: ({ embedding, model, cost, computedAt }): StoredEmbedding => ({ v: encodeEmbedding(embedding), m: model, c: cost, t: computedAt }),
          ttl: SEARCH_CONFIG.cache.embeddingSeconds,
          tags: [EMBEDDING_TAG],
          name: EMBEDDING_TAG,
        },
      )
    },
  }
}
