import 'server-only'
import { getDb } from '../db'
import { nextSearchCache } from './next-cache'
export { publishedNeighborhoods } from './next-cache'
import { runSearch, type SearchOptions, type SearchResponse } from './search'
import { neonPlacesStore } from './store'

export type { SearchDebug, SearchResponse, SearchResult } from './search'
export type { Chip } from './chips'
export type { LatLng } from './filters'
export type { IntentBar } from './intents'

/** Búsqueda de lugares publicados; se puede llamar directo desde un server component. */
export function searchPlaces(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  return runSearch(query, { store: neonPlacesStore(getDb()), cache: nextSearchCache }, options)
}
