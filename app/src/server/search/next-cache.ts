import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { getDb } from '../db'
import { SEARCH_CONFIG } from './config'
import { embedQuery, type SearchCache } from './cache'
import { interpretWithLlm } from './llm'
import { neonPlacesStore } from './store'

// La clave de cada entrada es el argumento: la consulta normalizada o el texto a embeber.
// expire marca el TTL de 24 h; revalidate tiene que ser menor y renueva en segundo plano.
const lifetime = { stale: 60 * 60, revalidate: SEARCH_CONFIG.cacheSeconds - 60 * 60, expire: SEARCH_CONFIG.cacheSeconds }

async function cachedInterpretation(normalized: string) {
  'use cache'
  cacheLife(lifetime)
  cacheTag('search-interpretation')
  return interpretWithLlm(normalized)
}

async function cachedEmbedding(text: string) {
  'use cache'
  cacheLife(lifetime)
  cacheTag('search-embedding')
  return embedQuery(text)
}

/** Barrios con lugares publicados, para la barra de filtros. Cambian sólo al publicar en el backoffice. */
export async function publishedNeighborhoods(): Promise<string[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('search-neighborhoods')
  return neonPlacesStore(getDb()).neighborhoods()
}

export const nextSearchCache: SearchCache = { interpret: cachedInterpretation, embed: cachedEmbedding }
