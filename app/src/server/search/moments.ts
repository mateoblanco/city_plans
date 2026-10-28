import { MOMENT_ORDER_TAGS } from '@shared/tags.ts'
import { SEARCH_CONFIG } from './config'
import type { CandidateRow } from './candidates'

/** Una señal: alguno de sus tags, styles o reservas. Cada señal cuenta una vez (vino o cócteles es una sola). */
type MomentSignal = { tags?: string[]; styles?: string[]; reservations?: string[] }

/**
 * Señales que acompañan a cada momento pedido, por el tag que lo activa: cada una que tiene el lugar suma momentFit
 * (hasta maxMomentSignals). Ordena entre los "has"; no cambia quién entra. Un momento sin entrada sólo ordena has/maybe.
 */
export const MOMENT_FIT: Partial<Record<string, MomentSignal[]>> = {
  date: [
    { tags: ['date'] }, { tags: ['cozy'] }, { tags: ['quiet'] }, { tags: ['wine', 'signature_cocktails', 'classic_cocktails'] },
    { tags: ['dinner'] }, { styles: ['cuidado', 'intermedio'] },
  ],
  celebration: [
    { tags: ['celebration'] }, { tags: ['groups'] }, { reservations: ['accepts', 'recommended'] }, { tags: ['picada', 'tapas'] },
    { tags: ['live_music'] },
  ],
  // Almuerzo de trabajo: el diccionario pide lunch y prefiere menu_of_the_day y quick.
  menu_of_the_day: [{ tags: ['menu_of_the_day'] }, { tags: ['quick'] }, { tags: ['lunch'] }],
  groups: [{ tags: ['groups'] }, { tags: ['picada', 'tapas'] }, { tags: ['draft_beer'] }, { tags: ['lively'] }],
}

/** Los tags pedidos que ordenan como un plato (shared/tags.ts MOMENT_ORDER_TAGS). */
export const momentsOf = (tags: string[]) => tags.filter((id) => MOMENT_ORDER_TAGS.includes(id))

type MomentRow = Pick<CandidateRow, 'tags' | 'style' | 'reservations'>

const hasSignal = (row: MomentRow, signal: MomentSignal) =>
  (signal.tags ?? []).some((id) => row.tags.includes(id)) ||
  (row.style !== null && (signal.styles ?? []).includes(row.style)) ||
  (signal.reservations ?? []).includes(row.reservations)

/** Señales del momento que más encaja (no se suman entre momentos: "cita con amigos" no cuenta doble), con tope. */
export function momentSignals(moments: string[], row: MomentRow): number {
  const counts = moments.map((id) => (MOMENT_FIT[id] ?? []).filter((signal) => hasSignal(row, signal)).length)
  return Math.min(Math.max(0, ...counts), SEARCH_CONFIG.boosts.maxMomentSignals)
}
