/** Señales guardadas en `places` de las que sale el puntaje. */
export type ProminenceSignals = {
  igFollowers: number | null
  /** Sucursal de cadena: los seguidores son de la marca, no de este local. */
  chainBranch?: boolean
}

// log10(seguidores + 1) topeado en 5: unos 100.000 seguidores ya valen 1.
// Si cambia, `yarn prominence:recompute` actualiza lo guardado.
export const IG_LOG_CAP = 5
// Sin dato de Instagram: neutro, no malo.
export const IG_NEUTRAL = 0.5
// Una sucursal usa los seguidores de la marca, descontados: no le gana a un local único igual de popular.
export const CHAIN_FACTOR = 0.85

/** Puntaje de 0 a 1, sólo con los seguidores de Instagram. Único lugar donde está la fórmula. */
export function computeProminence({ igFollowers, chainBranch = false }: ProminenceSignals): number {
  if (igFollowers === null) return IG_NEUTRAL
  const score = Math.min(Math.log10(Math.max(igFollowers, 0) + 1), IG_LOG_CAP) / IG_LOG_CAP
  return chainBranch ? score * CHAIN_FACTOR : score
}
