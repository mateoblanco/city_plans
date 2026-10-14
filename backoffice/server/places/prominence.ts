/** Señales guardadas en `places` de las que sale el puntaje. */
export type ProminenceSignals = {
  editorialMentions: number
  listedOrAwarded: boolean
  igFollowers: number | null
}

// Pesos de cada término; suman 1. Si cambian, `yarn prominence:recompute` actualiza lo guardado.
export const PROMINENCE_WEIGHTS = { editorial: 0.2, instagram: 0.7, listed: 0.1 } as const
// Desde 2 fuentes editoriales distintas el término editorial ya vale 1 (Exa trae 5 resultados y
// pocos lugares superan 2 notas reales).
export const EDITORIAL_CAP = 2
// log10(seguidores + 1) topeado en 5: unos 100.000 seguidores ya valen 1.
export const IG_LOG_CAP = 5
// Sin dato de Instagram (no tiene, o es sucursal de cadena): neutro, no malo.
export const IG_NEUTRAL = 0.5

const clamp = (value: number) => Math.min(Math.max(value, 0), 1)

function instagramTerm(followers: number | null) {
  if (followers === null) return IG_NEUTRAL
  return Math.min(Math.log10(Math.max(followers, 0) + 1), IG_LOG_CAP) / IG_LOG_CAP
}

/** Puntaje de 0 a 1. Único lugar donde están la fórmula, los pesos y los topes. */
export function computeProminence({ editorialMentions, listedOrAwarded, igFollowers }: ProminenceSignals): number {
  const editorial = Math.min(Math.max(editorialMentions, 0), EDITORIAL_CAP) / EDITORIAL_CAP
  return clamp(
    PROMINENCE_WEIGHTS.editorial * editorial +
    PROMINENCE_WEIGHTS.instagram * instagramTerm(igFollowers) +
    PROMINENCE_WEIGHTS.listed * (listedOrAwarded ? 1 : 0),
  )
}

/**
 * Señales estables: editorialMentions no baja y listedOrAwarded no vuelve a false.
 * igFollowers se actualiza siempre. Lo usan el guardado del pipeline y signals:refresh.
 */
export function stableSignals(
  current: { editorialMentions: number; listedOrAwarded: boolean },
  next: { editorialMentions?: number; listedOrAwarded?: boolean; igFollowers?: number | null },
): ProminenceSignals {
  return {
    editorialMentions: Math.max(current.editorialMentions, next.editorialMentions ?? 0),
    listedOrAwarded: current.listedOrAwarded || Boolean(next.listedOrAwarded),
    igFollowers: next.igFollowers ?? null,
  }
}
