import { SECTIONS, type SectionId } from '@shared/sections.ts'
import type { IntentId } from '@shared/intents.ts'
import { SEARCH_CONFIG } from './config'
import type { Fused } from './fuse'
import type { Interpretation, Lang } from './interpretation'
import type { PersonalGroup, PersonalId } from './personal'

/**
 * Una sección de la página de resultados: un grupo del catálogo o more = "Más opciones". total: cuántos resultados
 * cumplen la regla del grupo: si supera lo que muestra, tiene "Ver todos" (busca con `f=section:<id>`); null en discover y more.
 */
export type Section = { id: SectionId | PersonalId | 'more'; title: string; placeIds: string[]; total: number | null }

export type SectionsDebug = {
  /** null si la búsqueda se agrupó (o pudo agruparse); si no, por qué no. */
  notGrouped: string | null
  /** De dónde salieron los grupos pedidos: el modelo o las reglas. */
  source: 'llm' | 'rules' | null
  requested: SectionId[]
  chosen: { id: SectionId; count: number; avgScore: number }[]
  /** Pedidos que no llegaron a minPlaces lugares, con cuántos tenían. */
  dropped: { id: SectionId; count: number }[]
  /** Grupos del catálogo que desplazaron los grupos personales (los de menor puntaje promedio, por el tope de grupos). */
  displaced: SectionId[]
}

const MORE_TITLE: Record<Lang, string> = { es: 'Más opciones', en: 'More options' }

/**
 * Por qué la búsqueda no es amplia (null si lo es): un nombre, un plato o cualquier filtro obligatorio (categoría,
 * tag, dieta, precio, horario, exclude, sub-filtro o la sección de "Ver todos") la vuelven específica. La intención,
 * los momentos y el style en prefer, el barrio, la vibe y "cerca mío" no.
 */
export function notBroadReason(value: Interpretation, context: { pinned: boolean; subs: number; section?: boolean }): string | null {
  if (context.pinned || value.nameQuery) return 'nombre'
  if (context.section) return 'sección'
  if (value.dishes.length) return 'plato'
  if (value.must.categories.length) return 'categoría obligatoria'
  if (value.must.tags.length) return 'tag obligatorio'
  if (Object.values(value.must.diet).some(Boolean)) return 'dieta'
  if (value.must.price.length) return 'precio'
  if (value.must.openAt) return 'horario'
  if (value.exclude.categories.length || value.exclude.tags.length) return 'exclude'
  if (context.subs) return 'sub-filtro'
  return null
}

/** Grupos por reglas, en orden de prioridad, según la intención y el momento pedido. */
const RULES: Record<IntentId | 'none', { groups?: SectionId[]; date?: SectionId[]; base: SectionId[] }> = {
  eat: {
    groups: ['share', 'casual', 'world', 'discover'],
    date: ['special', 'world', 'outdoor', 'discover'],
    base: ['world', 'classics', 'share', 'outdoor', 'discover'],
  },
  bars: {
    groups: ['share', 'live_music', 'casual', 'outdoor', 'discover'],
    date: ['special', 'outdoor', 'live_music', 'discover'],
    base: ['share', 'live_music', 'outdoor', 'casual', 'discover'],
  },
  cafes: { base: ['outdoor', 'casual', 'special', 'discover'] },
  desserts: { base: ['outdoor', 'casual', 'discover'] },
  none: {
    date: ['special', 'eat', 'drinks', 'outdoor', 'casual', 'discover'],
    base: ['eat', 'drinks', 'outdoor', 'casual', 'special', 'discover'],
  },
}

export function ruleSections(value: Interpretation, intent: IntentId | null): SectionId[] {
  const rules = RULES[intent ?? 'none']
  const tags = value.prefer.tags
  return (tags.includes('groups') && rules.groups) || (tags.includes('date') && rules.date) || rules.base
}

/** Sin el grupo que repite lo pedido: Comer no muestra "Para comer", ni style casual "Descontracturado". */
function withoutRedundant(ids: SectionId[], value: Interpretation, intent: IntentId | null): SectionId[] {
  const redundant = new Set<SectionId>([
    ...(intent === 'eat' ? ['eat' as const] : []),
    ...(intent === 'bars' ? ['drinks' as const] : []),
    ...(value.prefer.style === 'casual' ? ['casual' as const] : []),
    ...(value.prefer.style === 'cuidado' ? ['special' as const] : []),
  ])
  return ids.filter((id) => !redundant.has(id))
}

/** Los grupos que pidió el modelo si dio suficientes ids válidos; si no (o sin modelo), los de las reglas. */
export function requestedSections(value: Interpretation, context: { fromLlm: boolean; intent: IntentId | null }) {
  const fromLlm = context.fromLlm ? withoutRedundant(value.sections, value, context.intent) : []
  if (fromLlm.length >= SEARCH_CONFIG.sections.minRequested) return { source: 'llm' as const, requested: fromLlm }
  return { source: 'rules' as const, requested: withoutRedundant(ruleSections(value, context.intent), value, context.intent) }
}

/**
 * Cuántas señales de la sección tiene el lugar: categorías, tags, style e ícono de su regla más los tags de bonus,
 * hasta maxSectionSignals. Descubrí no tiene señales.
 */
export function sectionSignals(id: SectionId, row: { categories: string[]; tags: string[]; style?: string | null; iconCategory?: string | null }): number {
  const { match, bonus } = SECTIONS[id] as { match: { categories?: string[]; tags?: string[]; style?: string; icons?: string[] }; bonus?: { tags?: string[] } }
  const count =
    (match.categories ?? []).filter((category) => row.categories.includes(category)).length +
    [...(match.tags ?? []), ...(bonus?.tags ?? [])].filter((tag) => row.tags.includes(tag)).length +
    (match.style !== undefined && row.style === match.style ? 1 : 0) +
    (row.iconCategory && match.icons?.includes(row.iconCategory) ? 1 : 0)
  return Math.min(count, SEARCH_CONFIG.boosts.maxSectionSignals)
}

/** Puntaje dentro de un grupo: el de siempre más sectionFit por señal (con la calidad del lugar). */
const scoreIn = (id: SectionId, item: Fused) => item.score + sectionSignals(id, item.row) * SEARCH_CONFIG.boosts.sectionFit * item.multiplier

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Si un lugar entra en un grupo. discover: menos conocido y más parecido a la consulta que la mitad de los resultados
 * (prominencia por debajo de la mediana, similitud semántica por encima); sin embedding no aplica.
 */
function matcher(items: Fused[]) {
  const prominenceMedian = median(items.map((item) => item.row.prominence))
  const similarities = items.flatMap((item) => (item.row.semantic === null ? [] : [item.row.semantic]))
  const similarityMedian = similarities.length ? median(similarities) : null
  return (id: SectionId, item: Fused) => {
    const { match } = SECTIONS[id] as { match: { categories?: string[]; tags?: string[]; style?: string; icons?: string[]; discover?: true } }
    const { row } = item
    if (match.discover) {
      return similarityMedian !== null && row.semantic !== null && row.prominence < prominenceMedian && row.semantic > similarityMedian
    }
    return (match.categories ?? []).some((category) => row.categories.includes(category)) ||
      (match.tags ?? []).some((tag) => row.tags.includes(tag)) ||
      (match.style !== undefined && row.style === match.style) ||
      (row.iconCategory !== null && (match.icons ?? []).includes(row.iconCategory))
  }
}

/**
 * Secciones de una búsqueda amplia: los grupos pedidos que llegan a minPlaces lugares (ordenados por el puntaje
 * promedio) y "Más opciones" con el resto. Sin "Mejores coincidencias": los primeros puntajes están casi empatados.
 * Cada lugar va una sola vez: en orden de ranking, al grupo en el que entra que tenga menos lugares hasta ahí (a igual
 * cantidad, el de más prioridad), para que ninguno se quede con todo; un grupo lleno (maxPlaces) no recibe más, y si
 * todos los que le sirven están llenos, el lugar va a "Más opciones". Los grupos chicos se descartan (los que ni solos
 * llegan, o el más chico) y sus lugares se reparten de nuevo. Sin ningún grupo que llegue, null: la lista de siempre.
 */
export function buildSections(items: Fused[], requested: SectionId[], lang: Lang, personal: PersonalGroup[] = []) {
  const config = SEARCH_CONFIG.sections
  const fits = matcher(items)
  // Los grupos personales van primero y sus lugares no se repiten en los del catálogo.
  const taken = new Set(personal.flatMap((group) => group.items.map((item) => item.row.id)))
  const available = items.filter((item) => !taken.has(item.row.id))

  let active = [...requested]
  const dropped: SectionsDebug['dropped'] = []
  let members = new Map<SectionId, Fused[]>()
  for (;;) {
    members = new Map(active.map((id) => [id, []]))
    for (const item of available) {
      const fitting = active.filter((candidate) => members.get(candidate)!.length < config.maxPlaces && fits(candidate, item))
      const id = fitting.reduce<SectionId | null>((best, candidate) => (best === null || members.get(candidate)!.length < members.get(best)!.length ? candidate : best), null)
      if (id) members.get(id)!.push(item)
    }
    const small = active.filter((id) => members.get(id)!.length < config.minPlaces)
    // Primero los que ni solos llegarían al mínimo; si no hay, el más chico (a igual tamaño, el de menor prioridad).
    const hopeless = small.filter((id) => available.filter((item) => fits(id, item)).length < config.minPlaces)
    const smallest = [...small].reverse().sort((a, b) => members.get(a)!.length - members.get(b)!.length).slice(0, 1)
    const drop = hopeless.length ? hopeless : smallest
    if (drop.length) {
      dropped.push(...drop.map((id) => ({ id, count: members.get(id)!.length })))
      active = active.filter((id) => !drop.includes(id))
    } else if (active.length > config.maxGroups) {
      active = active.slice(0, config.maxGroups)
    } else break
  }

  const average = (group: Fused[]) => group.reduce((sum, item) => sum + item.score, 0) / group.length
  // Quién entra sale del orden de siempre; adentro de cada grupo, primero los que tienen más señales de la sección.
  const sorted = active
    .map((id) => ({ id, items: [...members.get(id)!].sort((a, b) => scoreIn(id, b) - scoreIn(id, a)), avgScore: average(members.get(id)!) }))
    .sort((a, b) => b.avgScore - a.avgScore)
  // Con el tope de grupos, los personales desplazan a los del catálogo de menor puntaje promedio (sus lugares van a
  // "Más opciones").
  const chosen = sorted.slice(0, Math.max(0, config.maxGroups - personal.length))
  const displaced = sorted.slice(chosen.length).map((group) => group.id)
  const debug = { chosen: chosen.map(({ id, items: group, avgScore }) => ({ id, count: group.length, avgScore })), dropped, displaced }
  if (chosen.length + personal.length === 0) return { sections: null, ...debug }

  const grouped = new Set([...personal, ...chosen].flatMap((group) => group.items.map((item) => item.row.id)))
  const more = items.filter((item) => !grouped.has(item.row.id))
  const ids = (group: Fused[]) => group.map((item) => item.row.id)
  const total = (id: SectionId) => (id === 'discover' ? null : items.filter((item) => fits(id, item)).length)
  const sections: Section[] = [
    // Sin "Ver todos": total null.
    ...personal.map((group) => ({ id: group.id, title: group.title, placeIds: ids(group.items), total: null })),
    ...chosen.map((group) => ({ id: group.id, title: SECTIONS[group.id].title[lang], placeIds: ids(group.items), total: total(group.id) })),
    ...(more.length ? [{ id: 'more' as const, title: MORE_TITLE[lang], placeIds: ids(more), total: null }] : []),
  ]
  return { sections, ...debug }
}
