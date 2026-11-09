import 'server-only'
import { getCache, waitUntil } from '@vercel/functions'
import { cacheLife, cacheTag } from 'next/cache'
import { getDb } from '../db'
import { uncached, type SearchCache } from './cache'
import { layeredCache, type RemoteStore } from './runtime-cache'
import { neonPlacesStore } from './store'
import type { Venue } from './venues'

/**
 * Vercel Runtime Cache sólo en Vercel. Afuera (local, scripts) getCache cae a una memoria propia que no agrega nada a
 * la de layeredCache: sin remoto. Las claves ya vienen hasheadas con sha256 (el hash por defecto de getCache es de
 * 32 bits).
 */
function vercelRemote(): RemoteStore | null {
  if (!process.env.VERCEL) return null
  try {
    return getCache({ keyHashFunction: (key) => key })
  } catch (error) {
    console.warn('[search-cache] Runtime Cache no disponible:', error instanceof Error ? error.message : error)
    return null
  }
}

/** La escritura en el remoto termina después de la respuesta; fuera de Vercel, waitUntil no hace nada y sigue sola. */
function background(promise: Promise<unknown>) {
  try {
    waitUntil(promise)
  } catch {
    // Sin contexto de request: la promesa sigue igual.
  }
}

export const nextSearchCache: SearchCache = layeredCache(uncached, vercelRemote(), { background })

/** Barrios con lugares publicados, para la barra de filtros. Cambian sólo al publicar en el backoffice. */
export async function publishedNeighborhoods(): Promise<string[]> {
  'use cache: remote'
  cacheLife('hours')
  cacheTag('search-neighborhoods')
  return neonPlacesStore(getDb()).neighborhoods()
}

/** Venues (located_in) de los publicados, para reconocerlos en el texto. Cambian sólo al publicar en el backoffice. */
export async function publishedVenues(): Promise<Venue[]> {
  'use cache: remote'
  cacheLife('hours')
  cacheTag('search-venues')
  return neonPlacesStore(getDb()).venues()
}
