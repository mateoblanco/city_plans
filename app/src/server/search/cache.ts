import { embed } from 'ai'
import { SEARCH_CONFIG } from './config'
import { interpretWithLlm, type LlmResult } from './llm'

/**
 * Lo caro de una búsqueda que depende sólo del texto: la interpretación del modelo y el embedding.
 * En Next se cachea con "use cache" (next-cache.ts); en scripts y tests, en memoria o sin cache.
 */
export type SearchCache = {
  interpret(normalized: string): Promise<LlmResult>
  embed(text: string): Promise<number[]>
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: SEARCH_CONFIG.embeddingModel, value: text })
  return embedding
}

export const uncached: SearchCache = { interpret: interpretWithLlm, embed: embedQuery }

/** Cache en memoria con el mismo TTL, para el script de prueba. */
export function memoryCache(base: SearchCache = uncached, ttlMs = SEARCH_CONFIG.cacheSeconds * 1000): SearchCache {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>()
  const remember = <T,>(key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key)
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>
    const value = load()
    entries.set(key, { at: Date.now(), value })
    value.catch(() => entries.delete(key))
    return value
  }
  return {
    interpret: (normalized) => remember(`i:${normalized}`, () => base.interpret(normalized)),
    embed: (text) => remember(`e:${text}`, () => base.embed(text)),
  }
}
