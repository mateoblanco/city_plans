import { embed } from 'ai'
import { SEARCH_CONFIG } from './config'
import { gatewayCost } from './cost'
import { interpretWithLlm, type LlmResult } from './llm'
import { layeredCache } from './runtime-cache'

/**
 * Lo caro de una búsqueda que depende sólo del texto: la interpretación del modelo y el embedding.
 * En Next se cachea en memoria y en Vercel Runtime Cache (runtime-cache.ts, next-cache.ts); en scripts y tests, en
 * memoria o sin cache.
 */
export type SearchCache = {
  interpret(normalized: string): Promise<LlmResult>
  embed(text: string): Promise<EmbeddingResult>
}

/** De dónde salió un resultado cacheado: memoria de la instancia, Runtime Cache o ninguna (se calculó). */
export type CacheSource = 'memory' | 'remote' | 'none'

/** cost, computedAt y cacheSource como en LlmResult. */
export type EmbeddingResult = { embedding: number[]; model: string; cost: number | null; computedAt: number; cacheSource?: CacheSource }

export async function embedQuery(text: string): Promise<EmbeddingResult> {
  const model = SEARCH_CONFIG.embeddingModel
  const { embedding, providerMetadata } = await embed({ model, value: text })
  return { embedding, model, cost: gatewayCost(providerMetadata), computedAt: Date.now() }
}

export const uncached: SearchCache = { interpret: interpretWithLlm, embed: embedQuery }

/** Sólo la capa en memoria, con los mismos TTL: para el script de prueba y los tests. */
export function memoryCache(base: SearchCache = uncached): SearchCache {
  return layeredCache(base, null)
}
