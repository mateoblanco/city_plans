/** Señales guardadas en `places` de las que sale el puntaje. */
export type ProminenceSignals = {
  igFollowers: number | null
}

// log10(seguidores + 1) topeado en 5: unos 100.000 seguidores ya valen 1.
// Si cambia, `yarn prominence:recompute` actualiza lo guardado.
export const IG_LOG_CAP = 5
// Sin dato de Instagram (no tiene, o es sucursal de cadena): neutro, no malo.
export const IG_NEUTRAL = 0.5

/** Puntaje de 0 a 1, sólo con los seguidores de Instagram. Único lugar donde está la fórmula. */
export function computeProminence({ igFollowers }: ProminenceSignals): number {
  if (igFollowers === null) return IG_NEUTRAL
  return Math.min(Math.log10(Math.max(igFollowers, 0) + 1), IG_LOG_CAP) / IG_LOG_CAP
}
