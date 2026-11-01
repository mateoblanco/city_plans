import { iconFamily, type IconFamily } from '@shared/icon-categories.ts'
import { intentDef, type IntentId } from '@shared/intents.ts'
import { CUISINES, withSubcuisines } from '@shared/tags.ts'
import { SEARCH_CONFIG } from './config'
import type { CandidateRow, LikedPlace, LikeSimilarities, LikeSimilarity } from './candidates'
import type { Collapsed } from './branches'
import type { Fused } from './fuse'
import type { Lang } from './interpretation'
import { profileReasonTitle } from './labels'

/**
 * Bloques personales, con los likes del pedido (nunca se guardan). profile: "Porque te gustan…" (el perfil del tipo de
 * la búsqueda); similar: "Parecido a <lugar>"; for_you: la fila "Para vos" de las búsquedas sin grupos. Sólo eligen
 * lugares de la misma búsqueda: no reordenan la lista, no cambian quién entra y los lugares que te gustaron no suman nada.
 */
export type PersonalId = 'profile' | 'similar' | 'for_you'

/** Tipo de lugar: cada perfil junta los likes de un tipo y sólo elige lugares de ese tipo. */
export type PlaceKind = 'cafes' | 'bars' | 'eat' | 'desserts'

/** items: en orden de puntaje (de mayor a menor) o, con variedad, de elección. */
export type PersonalGroup = { id: PersonalId; title: string; items: Fused[] }

/** Un rasgo que se repite en los likes de un perfil y su peso: share × idf × k. */
export type ProfileTrait = { key: string; share: number; idf: number; k: number; weight: number }

type GroupPlace = { id: string; name: string; similarity: number; affinity: number | null; score: number | null; traits: string[] }

export type PersonalDebug = {
  /** null si el perfil se usó; si no, por qué no (profile=off, sin likes, búsqueda por nombre…). */
  skipped: string | null
  /** Los likes válidos (publicados, con embedding), su tipo y su puesto en esta búsqueda (null si no salió). */
  likes: { id: string; name: string; kind: PlaceKind | null; position: number | null }[]
  /** Ids de la cookie que no son lugares publicados con embedding. */
  ignored: string[]
  /** Un perfil por tipo con likes: si llega a minLikesProfile y sus rasgos, de mayor a menor peso. */
  profiles: { kind: PlaceKind; likes: string[]; enough: boolean; traits: ProfileTrait[] }[]
  /** El tipo de la búsqueda (el del perfil que se usa) y por qué; null sin tipo. */
  active: { kind: PlaceKind | null; reason: string }
  /**
   * El like elegido para "Parecido a": el mejor ubicado de los del tipo de la búsqueda que están entre los primeros
   * maxPosition. topCut: desde dónde un lugar está en su top `similarTopShare` de la base; threshold: el que se usó
   * (topCut con el piso). filtered: los que llegaban al umbral pero no pasaron los datos concretos (familia, style,
   * precio), con el motivo.
   */
  similarTo: {
    id: string
    name: string
    position: number
    topCut: number | null
    threshold: number
    filtered: { id: string; name: string; similarity: number; reason: string }[]
  } | null
  thresholds: {
    profile: number
    simFloor: number
    beta: number
    profileMaxPosition: number
    similarFloor: number
    similarTopShare: number
    similarMaxPosition: number
  }
  /**
   * Cada bloque que se intentó: si salió y, por lugar, el parecido (y en los del perfil, la afinidad, el puntaje y los
   * rasgos que comparte); si no, por qué. rule: el criterio de variedad; titleTraits: los rasgos del motivo; skipped: los
   * que pasaban el umbral y no entraron (otro tipo, cadena, variedad).
   */
  groups: {
    id: PersonalId
    title: string
    shown: boolean
    reason: string | null
    rule: 'familia' | 'barrio+marca' | null
    titleTraits: string[]
    places: GroupPlace[]
    skipped: { id: string; name: string; reason: string }[]
  }[]
}

const TITLES: Record<'profile' | 'for_you', Record<Lang, string>> = {
  profile: { es: 'Porque te gustan…', en: 'Based on what you like' },
  for_you: { es: 'Para vos', en: 'For you' },
}

const similarTitle = (name: string, lang: Lang) => (lang === 'es' ? `Parecido a ${name}` : `Similar to ${name}`)

export const emptyPersonalDebug = (skipped: string): PersonalDebug => ({
  skipped,
  likes: [],
  ignored: [],
  profiles: [],
  active: { kind: null, reason: skipped },
  similarTo: null,
  thresholds: {
    profile: SEARCH_CONFIG.personal.profileThreshold,
    simFloor: SEARCH_CONFIG.personal.affinity.simFloor,
    beta: SEARCH_CONFIG.personal.affinity.beta,
    profileMaxPosition: SEARCH_CONFIG.personal.profileMaxPosition,
    similarFloor: SEARCH_CONFIG.personal.similar.floor,
    similarTopShare: SEARCH_CONFIG.personal.similar.topShare,
    similarMaxPosition: SEARCH_CONFIG.personal.similar.maxPosition,
  },
  groups: [],
})

const KIND_BY_FAMILY: Partial<Record<IconFamily, PlaceKind>> = {
  coffee: 'cafes',
  bakery: 'cafes',
  breakfast: 'cafes',
  wine_cocktails: 'bars',
  beer: 'bars',
  sweets: 'desserts',
}

const KIND_BY_INTENT: Record<IntentId, PlaceKind> = { eat: 'eat', cafes: 'cafes', bars: 'bars', desserts: 'desserts' }

/** Sin ícono, por categorías: restaurant es lo más general, así que comer va última. */
const CATEGORY_KIND_ORDER: IntentId[] = ['cafes', 'bars', 'desserts', 'eat']

/**
 * Tipo de un lugar: por la familia de su ícono (las de comida son comer) o, sin ícono, por la primera intención que
 * tiene alguna de sus categorías; null si ninguna.
 */
export function placeKind(row: { iconCategory: string | null; categories: string[] }): PlaceKind | null {
  const family = iconFamily(row.iconCategory)
  if (family) return KIND_BY_FAMILY[family] ?? 'eat'
  const intent = CATEGORY_KIND_ORDER.find((id) => intentDef(id).match.categories?.some((category) => row.categories.includes(category)))
  return intent ? KIND_BY_INTENT[intent] : null
}

const PRICE_LEVELS = ['low', 'moderate', 'high']

/** Rasgos de un lugar para la afinidad: sus tags (sin uruguayan), su style (sin intermedio), su precio y su barrio. */
export function traitsOf(row: { tags: string[]; style: string | null; price: string; neighborhoodId: string }): string[] {
  return [
    ...new Set([
      ...row.tags.filter((tag) => tag !== 'uruguayan'),
      ...(row.style && row.style !== 'intermedio' ? [`style:${row.style}`] : []),
      ...(PRICE_LEVELS.includes(row.price) ? [`price:${row.price}`] : []),
      `barrio:${row.neighborhoodId}`,
    ]),
  ]
}

const traitClass = (key: string) => (key.startsWith('style:') ? 'style' : key.startsWith('price:') ? 'price' : key.startsWith('barrio:') ? 'barrio' : 'tag')

type Profile = { kind: PlaceKind; likes: LikedPlace[]; traits: ProfileTrait[] }

/**
 * Los rasgos que se repiten en los likes del perfil (al menos minLikes y minShare de ellos) y que no tiene casi toda la
 * base (idf ≥ minIdf), con su peso; de mayor a menor.
 */
export function profileTraits(likes: LikedPlace[], df: Record<string, number>, total: number): ProfileTrait[] {
  const config = SEARCH_CONFIG.personal.affinity
  const counts = new Map<string, number>()
  for (const like of likes) for (const key of traitsOf(like)) counts.set(key, (counts.get(key) ?? 0) + 1)
  return [...counts]
    .flatMap(([key, count]) => {
      const share = count / likes.length
      const idf = total > 1 ? Math.log(total / Math.max(1, df[key] ?? 1)) / Math.log(total) : 1
      if (count < config.minLikes || share < config.minShare || idf < config.minIdf) return []
      const k = config.weights[traitClass(key)]
      return [{ key, share, idf, k, weight: share * idf * k }]
    })
    .sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key))
}

/** Afinidad de un lugar con el perfil: la parte del peso de los rasgos del perfil que tiene (0 a 1). */
function affinityOf(traits: ProfileTrait[], row: Parameters<typeof traitsOf>[0]) {
  const total = traits.reduce((sum, trait) => sum + trait.weight, 0)
  if (!total) return { value: 0, shared: [] as string[] }
  const own = new Set(traitsOf(row))
  const shared = traits.filter((trait) => own.has(trait.key))
  return { value: shared.reduce((sum, trait) => sum + trait.weight, 0) / total, shared: shared.map((trait) => trait.key) }
}

/** Ids de una card: la sucursal que se muestra y las escondidas detrás. */
const cardIds = (item: Collapsed) => [item.row.id, ...item.branches.map((branch) => branch.row.id)]

type ConcreteRow = { iconCategory: CandidateRow['iconCategory']; tags: string[]; style: string | null; price: string }

/** Las cocinas del lugar con las hijas de los paraguas (asian → japanese…); uruguayan no cuenta: la tienen casi todos. */
const cuisinesOf = (row: ConcreteRow) =>
  new Set(row.tags.filter((tag) => Object.hasOwn(CUISINES, tag) && tag !== 'uruguayan').flatMap(withSubcuisines))

/**
 * Por qué candidate no se parece de verdad a liked (null si se parece): tiene que ser de la misma familia de ícono o
 * compartir una cocina, tener el mismo style y un precio a priceDistance niveles como mucho. Un style o precio
 * desconocido (en cualquiera de los dos) no descarta.
 */
export function concreteMismatch(liked: ConcreteRow, candidate: ConcreteRow): string | null {
  const family = iconFamily(liked.iconCategory)
  const likedCuisines = cuisinesOf(liked)
  const sameFamily = family !== null && family === iconFamily(candidate.iconCategory)
  if (!sameFamily && ![...cuisinesOf(candidate)].some((cuisine) => likedCuisines.has(cuisine))) {
    return `otra familia (${candidate.iconCategory ?? 'sin ícono'} vs ${liked.iconCategory ?? 'sin ícono'})`
  }
  if (liked.style && candidate.style && liked.style !== candidate.style) return `estilo ${candidate.style} ≠ ${liked.style}`
  const [a, b] = [PRICE_LEVELS.indexOf(liked.price), PRICE_LEVELS.indexOf(candidate.price)]
  if (a !== -1 && b !== -1 && Math.abs(a - b) > SEARCH_CONFIG.personal.similar.priceDistance) return `precio ${candidate.price} vs ${liked.price}`
  return null
}

type GroupDebug = PersonalDebug['groups'][number]
type Pick = { group: PersonalGroup | null; debug: GroupDebug }

/** Un lugar por encima del umbral de un bloque. affinity null en "Parecido a" (sólo cuenta el parecido con el like). */
type Entry = { item: Collapsed; similarity: number; affinity: number | null; score: number; traits: string[] }
type Skipped = { item: Collapsed; reason: string }

/** Familia del ícono para la variedad; sin ícono, la primera categoría. */
const familyKey = (row: CandidateRow) => iconFamily(row.iconCategory) ?? `categoría ${row.categories[0] ?? 'ninguna'}`

/**
 * Variedad de un bloque, en orden de puntaje: como mucho maxPerNeighborhood por barrio y una sucursal por marca y, si los
 * que pasan el umbral son de más de una familia de ícono, como mucho maxPerFamily de cada una. Sin alternativas, se
 * completa con los salteados, en orden: primero hasta max sin el tope de familia (sólo quedan de las que ya llegaron) y,
 * con menos de min, sin ningún tope (mejor repetir que no mostrar). chosen va en orden de elección.
 */
export function diversify<T extends { item: Collapsed }>(entries: T[], limits: { min: number; max: number }) {
  const config = SEARCH_CONFIG.personal
  const rule = new Set(entries.map((entry) => familyKey(entry.item.row))).size > 1 ? ('familia' as const) : ('barrio+marca' as const)
  const families = new Map<string, number>()
  const barrios = new Map<string, number>()
  const brands = new Set<string>()
  const chosen: T[] = []
  const blocked = (row: CandidateRow, byFamily: boolean) => {
    const family = familyKey(row)
    if (byFamily && (families.get(family) ?? 0) >= config.maxPerFamily) return `ya hay ${config.maxPerFamily} de la familia ${family}`
    if (row.brandKey && brands.has(row.brandKey)) return `otra sucursal de ${row.brandKey}`
    if ((barrios.get(row.neighborhoodId) ?? 0) >= config.maxPerNeighborhood) return `ya hay ${config.maxPerNeighborhood} en ${row.neighborhoodId}`
    return null
  }
  const add = (entry: T) => {
    const { row } = entry.item
    chosen.push(entry)
    families.set(familyKey(row), (families.get(familyKey(row)) ?? 0) + 1)
    barrios.set(row.neighborhoodId, (barrios.get(row.neighborhoodId) ?? 0) + 1)
    if (row.brandKey) brands.add(row.brandKey)
  }
  // reason null: no se llegó a mirar (el bloque ya estaba lleno).
  let skipped: { entry: T; reason: string | null }[] = entries.map((entry) => ({ entry, reason: null }))
  for (const byFamily of [rule === 'familia', false]) {
    skipped = skipped.flatMap((skip) => {
      if (chosen.length >= limits.max) return [skip]
      const reason = blocked(skip.entry.item.row, byFamily)
      if (reason) return [{ entry: skip.entry, reason }]
      add(skip.entry)
      return []
    })
  }
  // Sin alternativas, hasta min sin topes.
  for (const { entry } of skipped.splice(0, Math.max(0, limits.min - chosen.length))) add(entry)
  return { rule, chosen, skipped: skipped.flatMap(({ entry, reason }) => (reason ? [{ entry, reason }] : [])) }
}

const placeDebug = (entry: Entry): GroupPlace => ({
  id: entry.item.row.id,
  name: entry.item.row.name,
  similarity: entry.similarity,
  affinity: entry.affinity,
  score: entry.affinity === null ? null : entry.score,
  traits: entry.traits,
})

/**
 * Un bloque con los que pasan el umbral (entries, de mayor a menor puntaje), hasta max y con variedad si diverse; sin
 * min no hay bloque. title: el título según los elegidos (el motivo del perfil).
 */
function pickGroup(
  id: PersonalId,
  entries: Entry[],
  context: { limits: { min: number; max: number }; diverse: boolean; skipped: Skipped[]; title: (chosen: Entry[]) => { title: string; traits: string[] } },
): Pick {
  const { limits } = context
  const varied = context.diverse ? diversify(entries, limits) : { rule: null, chosen: entries.slice(0, limits.max), skipped: [] }
  const { title, traits } = context.title(varied.chosen)
  const skipped = [
    ...context.skipped.map(({ item, reason }) => ({ id: item.row.id, name: item.row.name, reason })),
    ...varied.skipped.map(({ entry, reason }) => ({ id: entry.item.row.id, name: entry.item.row.name, reason })),
  ]
  const debug: GroupDebug = { id, title, shown: false, reason: null, rule: varied.rule, titleTraits: traits, places: varied.chosen.map(placeDebug), skipped }
  if (entries.length < limits.min) {
    return { group: null, debug: { ...debug, reason: `${entries.length} resultados "has" por encima del umbral (mínimo ${limits.min})` } }
  }
  return { group: { id, title, items: varied.chosen.map((entry) => entry.item) }, debug: { ...debug, shown: true } }
}

/**
 * Tipo de la búsqueda: el de la intención o, sin intención, el que tiene al menos dominant.share de los primeros
 * dominant.top resultados "has" ("al aire libre" mezcla cafés y bares: un solo motivo necesita un solo perfil).
 */
export function activeKind(fused: Collapsed[], intent: IntentId | null): PersonalDebug['active'] {
  if (intent) return { kind: KIND_BY_INTENT[intent], reason: `intención ${intent}` }
  const { top, share } = SEARCH_CONFIG.personal.dominant
  const first = fused.filter((item) => item.matchLevel === 'has').slice(0, top)
  const counts = new Map<PlaceKind, number>()
  for (const item of first) {
    const kind = placeKind(item.row)
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const [kind, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0]
  const percent = first.length ? Math.round((count / first.length) * 100) : 0
  if (kind && count / first.length >= share) return { kind, reason: `dominante ${kind}: ${percent} % de los primeros ${first.length}` }
  return { kind: null, reason: `sin tipo dominante (${kind ?? 'ninguno'} ${percent} % de los primeros ${first.length}, mínimo ${Math.round(share * 100)} %)` }
}

/**
 * Bloques personales de una búsqueda ya rankeada (fused, en orden). grouped: la búsqueda se agrupa y hay como mucho un
 * grupo personal, "Parecido a" o, si no sale, "Porque te gustan…" (en la página va después del primer grupo del
 * catálogo); si no, la fila "Para vos". Los dos últimos usan el perfil del tipo de la búsqueda (activeKind) y sólo
 * eligen lugares de ese tipo. Sólo eligen entre los resultados "has" (no los "maybe", que quizás no tienen lo pedido);
 * ningún lugar que te gustó (como card o sucursal escondida) ni ninguna cadena entra en un bloque y ningún lugar se
 * repite entre bloques.
 */
export function personalize(fused: Collapsed[], data: LikeSimilarities, likeIds: string[], context: { grouped: boolean; lang: Lang; intent?: IntentId | null }) {
  const config = SEARCH_CONFIG.personal
  const debug = emptyPersonalDebug('')
  debug.skipped = null
  const liked = new Map(data.liked.map((place) => [place.id, place]))
  const position = (id: string) => {
    const index = fused.findIndex((item) => cardIds(item).includes(id))
    return index === -1 ? null : index + 1
  }
  // El lugar en sí (la card o una sucursal escondida detrás).
  const rowOf = (id: string) => fused.flatMap((item) => [item, ...item.branches]).find((item) => item.row.id === id)?.row ?? null
  debug.likes = data.liked.map((place) => ({ id: place.id, name: place.name, kind: placeKind(place), position: position(place.id) }))
  debug.ignored = likeIds.filter((id) => !liked.has(id))

  // Un perfil por tipo, con los likes de ese tipo.
  const profiles = new Map<PlaceKind, Profile>()
  for (const kind of new Set(debug.likes.flatMap((like) => like.kind ?? []))) {
    const likes = data.liked.filter((place) => placeKind(place) === kind)
    const traits = profileTraits(likes, data.df, data.total)
    const enough = likes.length >= config.minLikesProfile
    debug.profiles.push({ kind, likes: likes.map((place) => place.name), enough, traits })
    if (enough) profiles.set(kind, { kind, likes, traits })
  }
  const active = activeKind(fused, context.intent ?? null)
  debug.active = active

  const sims = new Map<string, LikeSimilarity>(data.rows.map((row) => [row.id, row]))
  // Parecido con el promedio de los likes del perfil: Σ cos(c, e_i) / ‖Σ e_i‖, con ‖Σ e_i‖² = Σ cos(e_i, e_j) (los
  // embeddings tienen norma 1).
  const profileSimilarity = (profile: Profile, id: string) => {
    const byLike = sims.get(id)?.byLike
    if (!byLike) return null
    const ids = profile.likes.map((place) => place.id)
    const norm = Math.sqrt(ids.reduce((sum, a) => sum + ids.reduce((inner, b) => inner + (a === b ? 1 : data.pairs[a]?.[b] ?? 0), 0), 0))
    return norm ? ids.reduce((sum, likeId) => sum + (byLike[likeId] ?? 0), 0) / norm : null
  }
  const chain = (item: Collapsed) => (item.row.brandCount >= config.chainMinBranches ? `cadena (${item.row.brandCount} sucursales)` : null)

  const likedIds = new Set(liked.keys())
  let pool = fused.filter((item) => item.matchLevel === 'has' && !cardIds(item).some((id) => likedIds.has(id)))
  const take = (pick: Pick) => {
    debug.groups.push(pick.debug)
    if (!pick.group) return null
    const taken = new Set(pick.group.items)
    pool = pool.filter((item) => !taken.has(item))
    return pick.group
  }
  const none = (id: PersonalId, title: string, reason: string): Pick => ({
    group: null,
    debug: { id, title, shown: false, reason, rule: null, titleTraits: [], places: [], skipped: [] },
  })

  /** "Porque te gustan…" o "Para vos": el perfil del tipo de la búsqueda, con afinidad y variedad. */
  const profileGroup = (id: 'profile' | 'for_you', candidates: Collapsed[], limits: { min: number; max: number }): Pick => {
    const fallback = TITLES[id][context.lang]
    if (!active.kind) return none(id, fallback, active.reason)
    const profile = profiles.get(active.kind)
    if (!profile) {
      const count = data.liked.filter((place) => placeKind(place) === active.kind).length
      return none(id, fallback, `sin perfil de ${active.kind} (${count} ${count === 1 ? 'like' : 'likes'}, mínimo ${config.minLikesProfile})`)
    }
    const { beta, simFloor } = config.affinity
    const entries: Entry[] = []
    const skipped: Skipped[] = []
    for (const item of candidates) {
      const similarity = profileSimilarity(profile, item.row.id)
      if (similarity === null) continue
      const affinity = affinityOf(profile.traits, item.row)
      const score = similarity + beta * affinity.value
      if (similarity < simFloor || score < config.profileThreshold) continue
      const kind = placeKind(item.row)
      const reason = kind !== profile.kind ? `otro tipo (${kind ?? 'sin tipo'})` : chain(item)
      if (reason) skipped.push({ item, reason })
      else entries.push({ item, similarity, affinity: affinity.value, score, traits: affinity.shared })
    }
    entries.sort((a, b) => b.score - a.score)
    // El motivo: los rasgos de más peso que tienen al menos traitShare de los elegidos.
    const title = (chosen: Entry[]) => {
      const owned = chosen.map((entry) => new Set(traitsOf(entry.item.row)))
      const traits = profile.traits
        .filter((trait) => owned.filter((set) => set.has(trait.key)).length >= config.reason.traitShare * chosen.length)
        .slice(0, config.reason.maxTraits)
        .map((trait) => trait.key)
      return { title: id === 'profile' ? profileReasonTitle(profile.kind, traits, context.lang) : fallback, traits }
    }
    return pickGroup(id, entries, { limits, diverse: true, skipped, title })
  }

  if (!context.grouped) {
    const forYou = take(profileGroup('for_you', pool, config.forYou))
    return { groups: [] as PersonalGroup[], forYou, debug }
  }

  const limits = { min: config.minPlaces, max: config.maxPlaces }
  const groups: PersonalGroup[] = []
  // "Parecido a" primero; "Porque te gustan…" sólo si aquel no sale.
  // El like del tipo de la búsqueda que más encaja: el mejor ubicado entre los primeros maxPosition (con "comer algo", la
  // parrilla y no el café); uno del puesto 100 no tiene nada que ver con lo pedido.
  const maxPosition = config.similar.maxPosition
  const best = debug.likes
    .filter((place) => place.position !== null && place.position <= maxPosition && (active.kind === null || place.kind === active.kind))
    .sort((a, b) => a.position! - b.position!)[0]
  const bestRow = best ? rowOf(best.id) : null
  if (best && bestRow) {
    // Entran los que pasan los datos concretos y están en su top `topShare` más parecido de toda la base, con piso.
    const topCut = liked.get(best.id)?.topCut ?? null
    const threshold = Math.max(config.similar.floor, topCut ?? config.similar.floor)
    const filtered: NonNullable<PersonalDebug['similarTo']>['filtered'] = []
    const entries: Entry[] = []
    const skipped: Skipped[] = []
    for (const item of pool) {
      const value = sims.get(item.row.id)?.byLike[best.id] ?? null
      if (value === null || value < threshold) continue
      const mismatch = concreteMismatch(bestRow, item.row)
      const reason = mismatch ? null : chain(item)
      if (mismatch) filtered.push({ id: item.row.id, name: item.row.name, similarity: value, reason: mismatch })
      else if (reason) skipped.push({ item, reason })
      else entries.push({ item, similarity: value, affinity: null, score: value, traits: [] })
    }
    entries.sort((a, b) => b.score - a.score)
    filtered.sort((a, b) => b.similarity - a.similarity)
    debug.similarTo = { id: best.id, name: best.name, position: best.position!, topCut, threshold, filtered }
    const title = similarTitle(best.name, context.lang)
    const similar = take(pickGroup('similar', entries, { limits, diverse: false, skipped, title: () => ({ title, traits: [] }) }))
    if (similar) {
      debug.groups.push(none('profile', TITLES.profile[context.lang], 'ya hay "Parecido a"').debug)
      return { groups: [similar], forYou: null, debug }
    }
  } else {
    const which = active.kind ? `ningún like de ${active.kind}` : 'ningún like'
    debug.groups.push(none('similar', similarTitle('…', context.lang), `${which} entre los primeros ${maxPosition}`).debug)
  }

  // "Porque te gustan…" sólo entre los primeros profileMaxPosition: más abajo ya no es lo que se pidió.
  const top = new Set<Collapsed>(fused.slice(0, config.profileMaxPosition))
  const profile = take(profileGroup('profile', pool.filter((item) => top.has(item)), limits))
  if (profile) groups.push(profile)
  return { groups, forYou: null, debug }
}
