import type { SearchResult } from '../search/search'
import { HOME_CONFIG } from './config'

/** La afinidad de cada lugar (id de card o de sucursal) con el perfil de su tipo: la de "Para vos" (runSearch con home). */
export type Affinity = Record<string, number>

/**
 * El pool de una fila reordenado con la afinidad de la persona, en memoria: cada lugar vale lo de su puesto (1 − i/N) más
 * `weight` por su afinidad normalizada en el pool (0 a 1; los sin afinidad, 0,5). Así suben los parecidos a sus gustos,
 * pero nadie se mueve más de N × weight puestos: un lugar muy bueno no desaparece. Con menos de 2 lugares con afinidad
 * (sin guardados, o ninguno de un tipo con perfil) queda igual.
 */
export function reorderByAffinity<T extends Pick<SearchResult, 'id'>>(places: T[], affinity: Affinity | null, weight: number = HOME_CONFIG.affinityWeight): T[] {
  if (!affinity) return places
  const known = places.flatMap((place) => (place.id in affinity ? [affinity[place.id]] : []))
  if (known.length < 2) return places
  const min = Math.min(...known)
  const span = Math.max(...known) - min
  if (span === 0) return places
  const count = places.length
  return places
    .map((place, index) => {
      const value = place.id in affinity ? (affinity[place.id] - min) / span : 0.5
      return { place, index, key: 1 - index / count + weight * value }
    })
    .sort((a, b) => b.key - a.key || a.index - b.index)
    .map((entry) => entry.place)
}

/**
 * "Abierto ahora cerca tuyo": manda la distancia, en bandas de HOME_CONFIG.nearBandM; dentro de una banda la afinidad
 * desempata (sin afinidad, del más cercano al más lejano).
 */
export function orderNear<T extends Pick<SearchResult, 'id'>>(items: { place: T; meters: number }[], affinity: Affinity | null, band: number = HOME_CONFIG.nearBandM): T[] {
  const score = (place: T) => affinity?.[place.id] ?? -Infinity
  return [...items]
    .sort((a, b) => Math.floor(a.meters / band) - Math.floor(b.meters / band) || score(b.place) - score(a.place) || a.meters - b.meters)
    .map((item) => item.place)
}
