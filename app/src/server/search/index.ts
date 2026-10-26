import 'server-only'
import { cache } from 'react'
import { getDb } from '../db'
import { nextSearchCache } from './next-cache'
export { publishedNeighborhoods } from './next-cache'
import { runSearch, type SearchOptions, type SearchResponse } from './search'
import { neonPlacesStore } from './store'

export type { SearchDebug, SearchResponse, SearchResult, WidenOption } from './search'
export type { Chip } from './chips'
export type { LatLng } from './filters'
export type { IntentBar } from './intents'

const deps = () => ({ store: neonPlacesStore(getDb()), cache: nextSearchCache })

// cache de React compara los argumentos por identidad: van como primitivos para que la barra de filtros y los
// resultados compartan una sola búsqueda por request. Dura sólo el request; los likes y el perfil van en la clave.
const cachedSearch = cache(
  (query: string, remove: string | null, filters: string | null, near: string | null, intent: string | null, sub: string | null, debug: boolean, widen: boolean, likes: string, profile: boolean) =>
    runSearch(query, deps(), { remove, filters, near, intent, sub, debug, widen, likes: likes ? likes.split(',') : [], profile }),
)

/** Búsqueda de lugares publicados; se puede llamar directo desde un server component. */
export function searchPlaces(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const { remove = null, filters = null, near = null, intent = null, sub = null, debug = false, widen = false, likes = [], profile = true, now } = options
  if (now) return runSearch(query, deps(), options)
  return cachedSearch(query, remove, filters, near, intent, sub, debug, widen, likes.join(','), profile)
}
