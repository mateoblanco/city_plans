import { SEARCH_CONFIG } from './config'
import type { LikeSimilarities, LikeSimilarity } from './candidates'
import type { Collapsed } from './branches'
import type { Fused } from './fuse'
import type { Lang } from './interpretation'

/**
 * Bloques personales, con los likes del pedido (nunca se guardan). profile: "Basado en lo que te gusta"; similar:
 * "Parecido a <lugar>"; for_you: la fila "Para vos" de las búsquedas sin grupos. Sólo eligen lugares de la misma
 * búsqueda: no reordenan la lista, no cambian quién entra y los lugares que te gustaron no suman nada.
 */
export type PersonalId = 'profile' | 'similar' | 'for_you'

/** items: en orden de parecido (de mayor a menor). */
export type PersonalGroup = { id: PersonalId; title: string; items: Fused[] }

export type PersonalDebug = {
  /** null si el perfil se usó; si no, por qué no (profile=off, sin likes, búsqueda por nombre…). */
  skipped: string | null
  /** Los likes válidos (publicados, con embedding) y su puesto en esta búsqueda (null si no salió). */
  likes: { id: string; name: string; position: number | null }[]
  /** Ids de la cookie que no son lugares publicados con embedding. */
  ignored: string[]
  /**
   * El like elegido para "Parecido a": el mejor ubicado de los que salieron en la búsqueda. topCut: desde dónde un lugar
   * está en su top 10 % de la base; threshold: el que se usó (topCut con el piso).
   */
  similarTo: { id: string; name: string; position: number; topCut: number | null; threshold: number } | null
  thresholds: { profile: number; similarFloor: number; similarTopShare: number }
  /** Cada bloque que se intentó: si salió y el parecido de cada lugar por encima del umbral; si no, por qué. */
  groups: { id: PersonalId; title: string; shown: boolean; reason: string | null; places: { id: string; name: string; similarity: number }[] }[]
}

const TITLES: Record<Exclude<PersonalId, 'similar'>, Record<Lang, string>> = {
  profile: { es: 'Basado en lo que te gusta', en: 'Based on what you like' },
  for_you: { es: 'Para vos', en: 'For you' },
}

const similarTitle = (name: string, lang: Lang) => (lang === 'es' ? `Parecido a ${name}` : `Similar to ${name}`)

export const emptyPersonalDebug = (skipped: string): PersonalDebug => ({
  skipped,
  likes: [],
  ignored: [],
  similarTo: null,
  thresholds: {
    profile: SEARCH_CONFIG.personal.profileThreshold,
    similarFloor: SEARCH_CONFIG.personal.similar.floor,
    similarTopShare: SEARCH_CONFIG.personal.similar.topShare,
  },
  groups: [],
})

/** Ids de una card: la sucursal que se muestra y las escondidas detrás. */
const cardIds = (item: Collapsed) => [item.row.id, ...item.branches.map((branch) => branch.row.id)]

type Pick = { group: PersonalGroup | null; debug: PersonalDebug['groups'][number] }

/**
 * Los lugares de pool con parecido ≥ threshold, de mayor a menor, hasta max; sin min por encima del umbral no hay
 * bloque. pool ya viene sin los lugares que te gustaron ni los que tomó otro bloque.
 */
function pickGroup(id: PersonalId, title: string, pool: Collapsed[], similarity: (item: Fused) => number | null, threshold: number, limits: { min: number; max: number }): Pick {
  const above = pool
    .flatMap((item) => {
      const value = similarity(item)
      return value !== null && value >= threshold ? [{ item, value }] : []
    })
    .sort((a, b) => b.value - a.value)
  const chosen = above.slice(0, limits.max)
  const places = chosen.map(({ item, value }) => ({ id: item.row.id, name: item.row.name, similarity: value }))
  if (above.length < limits.min) {
    return { group: null, debug: { id, title, shown: false, reason: `${above.length} resultados "has" por encima del umbral (mínimo ${limits.min})`, places } }
  }
  return { group: { id, title, items: chosen.map(({ item }) => item) }, debug: { id, title, shown: true, reason: null, places } }
}

/**
 * Bloques personales de una búsqueda ya rankeada (fused, en orden). grouped: la búsqueda se agrupa (grupos personales
 * primero: "Parecido a" y después "Basado en lo que te gusta" con lo que queda); si no, la fila "Para vos". Sólo
 * eligen entre los resultados "has" (no los "maybe", que quizás no tienen lo pedido). Ningún lugar que te gustó (como
 * card o sucursal escondida) entra en un bloque y ningún lugar se repite entre bloques.
 */
export function personalize(fused: Collapsed[], data: LikeSimilarities, likeIds: string[], context: { grouped: boolean; lang: Lang }) {
  const config = SEARCH_CONFIG.personal
  const debug = emptyPersonalDebug('')
  debug.skipped = null
  const liked = new Map(data.liked.map((place) => [place.id, place]))
  const position = (id: string) => {
    const index = fused.findIndex((item) => cardIds(item).includes(id))
    return index === -1 ? null : index + 1
  }
  debug.likes = data.liked.map(({ id, name }) => ({ id, name, position: position(id) }))
  debug.ignored = likeIds.filter((id) => !liked.has(id))

  const sims = new Map<string, LikeSimilarity>(data.rows.map((row) => [row.id, row]))
  const likedIds = new Set(liked.keys())
  let pool = fused.filter((item) => item.matchLevel === 'has' && !cardIds(item).some((id) => likedIds.has(id)))
  const take = (pick: Pick) => {
    debug.groups.push(pick.debug)
    if (!pick.group) return null
    const taken = new Set(pick.group.items)
    pool = pool.filter((item) => !taken.has(item))
    return pick.group
  }
  const profileOf = (item: Fused) => sims.get(item.row.id)?.profile ?? null
  const enoughForProfile = data.liked.length >= config.minLikesProfile
  const tooFew = (id: PersonalId, title: string): Pick => ({
    group: null,
    debug: { id, title, shown: false, reason: `${data.liked.length} likes (mínimo ${config.minLikesProfile})`, places: [] },
  })
  const limits = { min: config.minPlaces, max: config.maxPlaces }

  if (!context.grouped) {
    const title = TITLES.for_you[context.lang]
    const forYou = take(enoughForProfile ? pickGroup('for_you', title, pool, profileOf, config.profileThreshold, config.forYou) : tooFew('for_you', title))
    return { groups: [] as PersonalGroup[], forYou, debug }
  }

  const groups: PersonalGroup[] = []
  // "Parecido a" primero, con todo el pool; "Basado en lo que te gusta" toma lo que queda.
  // El like que más encaja en la búsqueda: el mejor ubicado de los que salieron (con "comer algo", la parrilla y no el café).
  const best = debug.likes.filter((place) => place.position !== null).sort((a, b) => a.position! - b.position!)[0]
  if (best) {
    // Entran los que están en su top 10 % más parecido de toda la base publicada, con piso.
    const topCut = liked.get(best.id)?.topCut ?? null
    const threshold = Math.max(config.similar.floor, topCut ?? config.similar.floor)
    debug.similarTo = { id: best.id, name: best.name, position: best.position!, topCut, threshold }
    const title = similarTitle(best.name, context.lang)
    const similar = take(pickGroup('similar', title, pool, (item) => sims.get(item.row.id)?.byLike[best.id] ?? null, threshold, limits))
    if (similar) groups.push(similar)
  } else {
    debug.groups.push({ id: 'similar', title: similarTitle('…', context.lang), shown: false, reason: 'ningún like salió en esta búsqueda', places: [] })
  }

  const profileTitle = TITLES.profile[context.lang]
  const profile = take(enoughForProfile ? pickGroup('profile', profileTitle, pool, profileOf, config.profileThreshold, limits) : tooFew('profile', profileTitle))
  if (profile) groups.push(profile)
  return { groups, forYou: null, debug }
}
