import { DEFAULT_DISH_INTENT, INTENT_IDS, INTENTS, isIntentId, type IntentDef, type IntentId, type IntentMatch, type SubFilterDef } from '@shared/intents.ts'
import type { FilterGroup } from './candidates'
import type { Chip } from './chips'
import type { ChipKind, Interpretation } from './interpretation'

/** Intención y sub-filtros pedidos en la URL (`intent=bars&sub=cocktails,live_music`), ya validados. */
export type IntentUrl = { intent: IntentId | null; subs: string[] }

/** Un sub-filtro activo: de la URL, del texto o de los dos. removeKeys apagan lo que vino del texto. */
export type ActiveSub = { id: string; fromUrl: boolean; fromText: boolean; removeKeys: string[] }

/** Lo que la barra necesita para mostrar y cambiar la intención. */
export type IntentBar = {
  intent: { id: IntentId; fromText: boolean } | null
  /** La intención que eligió el texto (aunque la URL pida otra): al cambiar de intención se suma a remove. */
  textIntent: IntentId | null
  subs: { id: string; label: string; active: boolean; fromText: boolean; removeKeys: string[] }[]
  /** Lo que pidió el texto y no es un sub-filtro (platos, tags, categorías que no son la intención). */
  extras: Chip[]
}

export const emptyBar = (): IntentBar => ({ intent: null, textIntent: null, subs: [], extras: [] })

const def = (id: IntentId): IntentDef => INTENTS[id]

const list = (raw: string | null | undefined) =>
  (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

/** Descarta la intención desconocida y los sub-filtros que no son de la intención. */
export function parseIntent(rawIntent: string | null | undefined, rawSub: string | null | undefined): IntentUrl {
  const id = rawIntent?.trim() ?? ''
  if (!isIntentId(id)) return { intent: null, subs: [] }
  return { intent: id, subs: [...new Set(list(rawSub))].filter((sub) => sub in def(id).subs) }
}

const hits = (match: IntentMatch, categories: string[], tags: string[]) =>
  (match.categories ?? []).some((id) => categories.includes(id)) || (match.tags ?? []).some((id) => tags.includes(id))

/** Lugar: además, algún par categoría + tag de all (un bar con comida). Lo pedido en el texto no lo usa. */
const placeHits = (match: IntentMatch, categories: string[], tags: string[]) =>
  hits(match, categories, tags) ||
  (match.all ?? []).some((pair) => pair.categories.some((id) => categories.includes(id)) && pair.tags.some((id) => tags.includes(id)))

/** Lo del sub-filtro que, pedido en el texto, lo elige: sus categorías y tags ("con terraza" es outdoor: Al aire libre). */
function textMatch(sub: SubFilterDef): IntentMatch {
  return { categories: sub.categories, tags: sub.tags ?? [] }
}

/** ¿Lo pedido (categorías y tags) apunta a esta intención? Por su match, sus sub-filtros que votan o detect. */
function points(id: IntentId, categories: string[], tags: string[]) {
  const intent = def(id)
  return (
    hits(intent.match, categories, tags) ||
    intent.detect.some((tag) => tags.includes(tag)) ||
    Object.values(intent.subs).some((sub) => sub.vote !== false && hits(textMatch(sub), categories, tags))
  )
}

/**
 * Votos por intención: un voto por cada categoría, tag o plato exigido que apunta a ella, y uno por el verbo
 * ("comer" → Comer). Un plato que no apunta a ninguna vota la intención por defecto (Comer). Las preferencias y la
 * vibe no votan.
 */
export function intentVotes(value: Interpretation): Partial<Record<IntentId, number>> {
  // El nombre de una fila de la home trae la intención de la fila: sus tags no votan ("after office" no es Bares).
  if (value.rowPhrase) return value.intent ? { [value.intent]: 1 } : {}
  const votes: Partial<Record<IntentId, number>> = {}
  const vote = (categories: string[], tags: string[], fallback: IntentId | null) => {
    const targets = INTENT_IDS.filter((id) => points(id, categories, tags))
    for (const id of targets.length ? targets : fallback ? [fallback] : []) votes[id] = (votes[id] ?? 0) + 1
  }
  for (const id of value.must.categories) vote([id], [], null)
  for (const id of value.must.tags) vote([], [id], null)
  for (const dish of value.dishes) vote(dish.relatedCategories, dish.relatedTags, DEFAULT_DISH_INTENT)
  if (value.intent) votes[value.intent] = (votes[value.intent] ?? 0) + 1
  return votes
}

/** La intención con más votos; ninguna si nadie votó o hay empate (el texto es ambiguo o no encaja). */
export function detectIntent(value: Interpretation): IntentId | null {
  const ranked = (Object.entries(intentVotes(value)) as [IntentId, number][]).sort((a, b) => b[1] - a[1])
  if (!ranked.length || ranked[1]?.[1] === ranked[0][1]) return null
  return ranked[0][0]
}

export type ResolvedIntent = {
  intent: IntentId | null
  /** La intención salió del texto (la URL no pide ninguna). */
  fromText: boolean
  textIntent: IntentId | null
  votes: Partial<Record<IntentId, number>>
  subs: ActiveSub[]
  aliasKeys: string[]
  /** Platos que activaron un sub-filtro ("helado" → Helado): siguen filtrando, pero no se muestran como extra. */
  absorbedDishes: string[]
  /** Lo del texto sin lo que quedó representado por la intención o sus sub-filtros. */
  interpretation: Interpretation
}

/**
 * Intención final: la de la URL o, si no hay, la del texto (salvo que se haya quitado con `remove=intent:x`).
 * Con una intención elegida, lo que pidió el texto y le corresponde deja de ser un filtro suelto: un sub-filtro
 * se activa ("cócteles" → Tragos) y una categoría alias queda cubierta ("bares" → Bares). Pasa a preferencia.
 */
export function resolveIntent(fromText: Interpretation, url: IntentUrl, removals: { kind: ChipKind; id: string }[]): ResolvedIntent {
  const detected = detectIntent(fromText)
  const textIntent = detected && !removals.some((removal) => removal.kind === 'intent' && removal.id === detected) ? detected : null
  const intent = url.intent ?? textIntent
  const votes = intentVotes(fromText)
  if (!intent) return { intent: null, fromText: false, textIntent, votes, subs: [], aliasKeys: [], absorbedDishes: [], interpretation: fromText }

  const subs = new Map<string, ActiveSub>()
  const fromTextSub = (id: string, key: string) => {
    const current = subs.get(id) ?? { id, fromUrl: false, fromText: true, removeKeys: [] }
    subs.set(id, { ...current, fromText: true, removeKeys: [...new Set([...current.removeKeys, key])] })
  }
  for (const id of url.intent === intent ? url.subs : []) subs.set(id, { id, fromUrl: true, fromText: false, removeKeys: [] })
  const subEntries = Object.entries(def(intent).subs)
  const subOf = (categories: string[], tags: string[]) => subEntries.find(([, sub]) => hits(textMatch(sub), categories, tags))?.[0] ?? null

  const aliasKeys: string[] = []
  const absorbed = { categories: [] as string[], tags: [] as string[] }
  const categories = fromText.must.categories.filter((id) => {
    const sub = subOf([id], [])
    if (sub) fromTextSub(sub, `category:${id}`)
    else if ((def(intent).aliases as string[]).includes(id)) aliasKeys.push(`category:${id}`)
    else return true
    absorbed.categories.push(id)
    return false
  })
  const tags = fromText.must.tags.filter((id) => {
    const sub = subOf([], [id])
    if (sub) {
      fromTextSub(sub, `tag:${id}`)
      absorbed.tags.push(id)
    }
    return !sub
  })
  // Una preferencia que es un sub-filtro ("cafés para trabajar" → Para trabajar) también lo activa: la barra no
  // puede mostrarlo apagado si el texto lo pidió. Sigue como preferencia; quitar el sub-filtro la quita.
  for (const id of fromText.prefer.tags) {
    const sub = subOf([], [id])
    if (sub) fromTextSub(sub, `prefer:${id}`)
  }
  const absorbedDishes = fromText.dishes.flatMap((dish) => {
    const sub = subOf(dish.relatedCategories, dish.relatedTags)
    if (!sub) return []
    fromTextSub(sub, `dish:${dish.name}`)
    return [dish.name]
  })

  // Las del texto en el mismo orden que la configuración.
  const ordered = subEntries.flatMap(([id]) => (subs.has(id) ? [subs.get(id)!] : []))
  return {
    intent,
    fromText: url.intent === null,
    textIntent,
    votes,
    subs: ordered,
    aliasKeys,
    absorbedDishes,
    // Lo absorbido sigue ordenando y explicando los resultados ("cafés" → los cafés antes que las panaderías).
    interpretation: {
      ...fromText,
      must: { ...fromText.must, categories, tags },
      prefer: {
        categories: [...new Set([...fromText.prefer.categories, ...absorbed.categories])],
        tags: [...new Set([...fromText.prefer.tags, ...absorbed.tags])],
        style: fromText.prefer.style,
      },
    },
  }
}

/** Los grupos de los sub-filtros activos, sin el de la intención. */
export function subGroups(intent: IntentId | null, subs: string[]): SubFilterDef[] {
  if (!intent) return []
  const definition = def(intent)
  return subs.flatMap((id) => (definition.subs[id] ? [definition.subs[id]] : []))
}

/**
 * ¿Lo pedido trae un tag que manda sobre el match de la intención (`tagWins`)? Por un sub-filtro activo (Comer ›
 * Brunch) o por un tag exigido o de un plato ("sándwiches", "menú del día"). Al relajar, el tag pasa a preferencia y
 * la intención vuelve a filtrar.
 */
export function tagWinsOverIntent(intent: IntentId | null, subs: string[], tags: readonly string[] = []): boolean {
  const wins: readonly string[] | undefined = intent ? def(intent).tagWins : undefined
  if (!wins?.length) return false
  const requested = [...subGroups(intent, subs).flatMap((group) => group.tags ?? []), ...tags]
  return requested.some((id) => wins.includes(id))
}

/**
 * Grupos de filtro: uno por la intención y uno por sub-filtro. Cada grupo es "cualquiera de"; entre grupos, "y".
 * tags: los exigidos y los de los platos; si alguno (o un sub-filtro) manda sobre la intención, su grupo no va.
 */
export function intentGroups(intent: IntentId | null, subs: string[], tags: readonly string[] = []): IntentMatch[] {
  if (!intent) return []
  const gate = tagWinsOverIntent(intent, subs, tags) ? [] : [def(intent).match]
  return [...gate, ...subGroups(intent, subs)]
}

/** Lo que pide un sub-filtro, para pasarlo a preferencia al relajar. */
export function subTerms(intent: IntentId | null, subs: string[]): { categories: string[]; tags: string[] } {
  const groups = subGroups(intent, subs)
  return { categories: groups.flatMap((group) => group.categories ?? []), tags: groups.flatMap((group) => group.tags ?? []) }
}

/** ¿El lugar cumple el grupo? Igual que el SQL de candidates. */
export function matchesGroup(group: FilterGroup, row: { categories: string[]; tags: string[]; featured: boolean; style?: string | null; iconCategory?: string | null }) {
  return Boolean(group.featured && row.featured) || Boolean(group.style && row.style === group.style) ||
    Boolean(row.iconCategory && group.icons?.includes(row.iconCategory)) || placeHits(group, row.categories, row.tags)
}

/** Barra de la respuesta: todos los sub-filtros de la intención (activos o no) y los extras del texto. */
export function buildBar(resolved: ResolvedIntent, extras: Chip[]): IntentBar {
  const { intent } = resolved
  const active = new Map(resolved.subs.map((sub) => [sub.id, sub]))
  return {
    intent: intent ? { id: intent, fromText: resolved.fromText } : null,
    textIntent: resolved.textIntent,
    subs: intent
      ? Object.entries(def(intent).subs).map(([id, sub]) => ({
          id,
          label: sub.label.es,
          active: active.has(id),
          fromText: active.get(id)?.fromText ?? false,
          removeKeys: active.get(id)?.removeKeys ?? [],
        }))
      : [],
    extras,
  }
}

export { INTENT_IDS, INTENTS, type IntentId }
