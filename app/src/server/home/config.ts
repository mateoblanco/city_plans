import type { IntentId } from '@shared/intents.ts'
import type { SectionId } from '@shared/sections.ts'
import type { TagId } from '@shared/tags.ts'
import type { SearchUrl } from '@/components/pages/SearchPage/utils/search-href'
import type { DietKey } from '../search/interpretation'

/**
 * Búsqueda estructurada de una fila de la home: nunca texto, así no hay modelo ni embedding (sólo SQL). Los mismos
 * parámetros arman la búsqueda y su "Ver todos". Las cocinas son tags (`tags: ['japanese']`).
 */
export type HomeSearch = {
  intent?: IntentId
  sub?: string[]
  diet?: DietKey[]
  tags?: TagId[]
  /** Un grupo del catálogo de /shared/sections.ts: la misma regla que su "Ver todos" en la búsqueda. */
  section?: Exclude<SectionId, 'discover'>
}

export type HomeSectionDef = { id: string; title: string; search: HomeSearch }

/**
 * Filas de la home, en este orden; "Guardados" (server/home/saved.ts) y "Para vos" (likes, sale del perfil) van antes
 * de todas y no están acá.
 */
export const HOME_SECTIONS: HomeSectionDef[] = [
  { id: 'lunch', title: 'Para almorzar', search: { intent: 'eat', sub: ['lunch'] } },
  { id: 'brunch', title: 'Lugares para brunchear', search: { tags: ['brunch'] } },
  { id: 'drinks', title: 'Para tomar algo', search: { intent: 'bars' } },
  { id: 'world', title: 'Comidas del mundo', search: { section: 'world' } },
  { id: 'classics', title: 'Clásicos uruguayos', search: { section: 'classics' } },
  { id: 'vegetarian', title: 'Vegetariano', search: { diet: ['vegetarian'] } },
  { id: 'snack', title: 'Merienda', search: { tags: ['afternoon_snack'] } },
  { id: 'gluten_free', title: 'Sin TACC', search: { diet: ['glutenFree'] } },
]

export const HOME_CONFIG = {
  /** Una fila con menos lugares (después de sacar los repetidos y las cadenas) no se muestra. */
  minPlaces: 4,
  maxPlaces: 8,
  /** Cuántos resultados de cada búsqueda se guardan en la caché, para tener de dónde completar sin repetir. */
  candidates: 40,
} as const

/**
 * La búsqueda de una fila como estado de /search (sin texto): con esto se busca y se arma el "Ver todos". Siempre con
 * "Abre hoy" (abierto ahora o abre más tarde hoy, hora de Montevideo), así el "Ver todos" muestra lo mismo.
 */
export function homeSearchUrl(search: HomeSearch): SearchUrl {
  const f = [
    'open:today',
    ...(search.diet ?? []).map((key) => `diet:${key}`),
    ...(search.tags ?? []).map((id) => `tag:${id}`),
    ...(search.section ? [`section:${search.section}`] : []),
  ].join(',')
  return { q: '', intent: search.intent ?? null, sub: search.intent && search.sub?.length ? search.sub.join(',') : null, f }
}
