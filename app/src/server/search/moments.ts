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

type GroupRow = Pick<CandidateRow, 'tags' | 'categories' | 'iconCategory' | 'style'>

const hasTag = (row: GroupRow, ...ids: string[]) => ids.some((id) => row.tags.includes(id))

/**
 * Señales de que un lugar sirve para ir en grupo aunque no tenga el tag groups. Cada familia cuenta una vez. Quedan
 * afuera las muy comunes (el tag pizza, drinks, casual solo) y lo que no distingue a un grupo (late_night, dj).
 */
const GROUP_SIGNALS: ((row: GroupRow) => boolean)[] = [
  (row) => hasTag(row, 'draft_beer', 'craft_beer'),
  (row) => hasTag(row, 'picada', 'tapas'),
  (row) => hasTag(row, 'pool_table', 'board_games', 'watch_football', 'karaoke'),
  (row) => hasTag(row, 'live_music'),
  (row) => hasTag(row, 'lively'),
  (row) => hasTag(row, 'classic_cocktails', 'signature_cocktails', 'happy_hour'),
  (row) => row.categories.includes('pizzeria') || row.iconCategory === 'pizza',
  (row) => row.style === 'casual' && (row.categories.includes('bar') || row.categories.includes('brewery')),
]

export const groupSignals = (row: GroupRow) => GROUP_SIGNALS.filter((signal) => signal(row)).length

/** Pub o cervecería: lo que el lugar es ya dice que se va en grupo (el ícono beer_pub se define así). */
export const hasGroupIdentity = (row: GroupRow) => row.iconCategory === 'beer_pub' || row.iconCategory === 'beer' || row.categories.includes('brewery')

/** Sirve para ir en grupo: tiene el tag, es un pub o cervecería, o suma suficientes señales. */
export const fitsGroup = (row: GroupRow) => row.tags.includes('groups') || hasGroupIdentity(row) || groupSignals(row) >= SEARCH_CONFIG.boosts.minGroupSignals

/** El lugar cumple alguno de los momentos pedidos: su tag o, con groups, fitsGroup. */
export const matchesMoment = (moments: readonly string[], row: GroupRow) => moments.some((id) => row.tags.includes(id) || (id === 'groups' && fitsGroup(row)))

/**
 * Empujón con groups pedido: el tag (que además suma preferTag) o la identidad de pub, una sola vez, más las señales con
 * tope. 0 si no se pidió.
 */
export function groupFit(moments: readonly string[], row: GroupRow): number {
  if (!moments.includes('groups')) return 0
  const { groupFit: tag, groupIdentity, groupSignal, maxGroupSignals } = SEARCH_CONFIG.boosts
  const base = row.tags.includes('groups') ? tag : hasGroupIdentity(row) ? groupIdentity : 0
  return base + Math.min(groupSignals(row), maxGroupSignals) * groupSignal
}
