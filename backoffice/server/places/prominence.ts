/** Señales guardadas en `places` de las que sale el puntaje. */
export type ProminenceSignals = {
  igFollowers: number | null
  /** Sucursal de cadena: los seguidores son de la marca, no de este local. */
  chainBranch?: boolean
}

// log10(seguidores + 1) topeado en 5: unos 100.000 seguidores ya valen 1.
// Si cambia, `yarn prominence:recompute` actualiza lo guardado.
export const IG_LOG_CAP = 5
// Sin ningún lugar con seguidores para sacar la mediana: el medio de la escala.
export const IG_NEUTRAL = 0.5
// Una sucursal usa los seguidores de la marca, descontados: no le gana a un local único igual de popular.
export const CHAIN_FACTOR = 0.85

/** Término de Instagram, de 0 a 1, sin el descuento de cadena. */
export function igTerm(igFollowers: number): number {
  return Math.min(Math.log10(Math.max(igFollowers, 0) + 1), IG_LOG_CAP) / IG_LOG_CAP
}

/**
 * Mediana de igTerm entre los seguidores que hay (los null no cuentan): el valor de un lugar sin dato. Quien la usa
 * la calcula una vez por operación (una consulta, `drizzleIgMedian`, o con los rows que ya cargó), nunca por lugar.
 */
export function medianIgTerm(followers: readonly (number | null)[]): number {
  const terms = followers.flatMap((value) => value === null ? [] : [igTerm(value)]).sort((a, b) => a - b)
  if (terms.length === 0) return IG_NEUTRAL
  const middle = terms.length >> 1
  return terms.length % 2 ? terms[middle] : (terms[middle - 1] + terms[middle]) / 2
}

/**
 * Puntaje de 0 a 1, sólo con los seguidores de Instagram. Único lugar donde está la fórmula. Sin seguidores vale
 * igMedian (la mediana de los publicados, `medianIgTerm`), también en una cadena y sin el ×0,85: la falta de dato es
 * neutra, no un castigo.
 */
export function computeProminence({ igFollowers, chainBranch = false }: ProminenceSignals, igMedian: number): number {
  if (igFollowers === null) return igMedian
  const score = igTerm(igFollowers)
  return chainBranch ? score * CHAIN_FACTOR : score
}
