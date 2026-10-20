import { SECTIONS, type SectionId } from '@shared/sections.ts'
import type { IntentId } from '@shared/intents.ts'
import { SEARCH_CONFIG } from './config'
import type { Fused } from './fuse'
import type { Interpretation, Lang } from './interpretation'

/** Una sección de la página de resultados: top = "Mejores coincidencias", more = "Más opciones". */
export type Section = { id: SectionId | 'top' | 'more'; title: string; placeIds: string[] }

export type SectionsDebug = {
  /** null si la búsqueda se agrupó (o pudo agruparse); si no, por qué no. */
  notGrouped: string | null
  /** De dónde salieron los grupos pedidos: el modelo o las reglas. */
  source: 'llm' | 'rules' | null
  requested: SectionId[]
  chosen: { id: SectionId; count: number; avgScore: number }[]
  /** Pedidos que no llegaron a minPlaces lugares, con cuántos tenían. */
  dropped: { id: SectionId; count: number }[]
}

const TITLES: Record<'top' | 'more', Record<Lang, string>> = {
  top: { es: 'Mejores coincidencias', en: 'Best matches' },
  more: { es: 'Más opciones', en: 'More options' },
}

/**
 * Por qué la búsqueda no es amplia (null si lo es): un nombre, un plato o cualquier filtro obligatorio (categoría,
 * tag, dieta, precio, horario, exclude o sub-filtro) la vuelven específica. La intención, los momentos y el style
 * en prefer, el barrio, la vibe y "cerca mío" no.
 */
export function notBroadReason(value: Interpretation, context: { pinned: boolean; subs: number }): string | null {
  if (context.pinned || value.nameQuery) return 'nombre'
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
    const { match } = SECTIONS[id] as { match: { categories?: string[]; tags?: string[]; style?: string; discover?: true } }
    const { row } = item
    if (match.discover) {
      return similarityMedian !== null && row.semantic !== null && row.prominence < prominenceMedian && row.semantic > similarityMedian
    }
    return (match.categories ?? []).some((category) => row.categories.includes(category)) ||
      (match.tags ?? []).some((tag) => row.tags.includes(tag)) ||
      (match.style !== undefined && row.style === match.style)
  }
}

/**
 * Secciones de una búsqueda amplia: "Mejores coincidencias" (los primeros del ranking), los grupos pedidos que
 * llegan a minPlaces lugares (ordenados por el puntaje promedio) y "Más opciones" con el resto. Cada lugar va una
 * sola vez: en orden de ranking, al grupo en el que entra que tenga menos lugares hasta ahí (a igual cantidad, el de
 * más prioridad), para que ninguno se quede con todo; los grupos chicos se descartan (los que ni solos llegan, o el más
 * chico) y sus lugares se reparten de nuevo. Sin ningún grupo que llegue, null: la lista de siempre.
 */
export function buildSections(items: Fused[], requested: SectionId[], lang: Lang) {
  const config = SEARCH_CONFIG.sections
  const topCount = Math.min(config.top.max, Math.max(config.top.min, Math.round(items.length / 4)))
  const top = items.slice(0, topCount)
  const rest = items.slice(topCount)
  const fits = matcher(items)

  let active = [...requested]
  const dropped: SectionsDebug['dropped'] = []
  let members = new Map<SectionId, Fused[]>()
  for (;;) {
    members = new Map(active.map((id) => [id, []]))
    for (const item of rest) {
      const fitting = active.filter((candidate) => fits(candidate, item))
      const id = fitting.reduce<SectionId | null>((best, candidate) => (best === null || members.get(candidate)!.length < members.get(best)!.length ? candidate : best), null)
      if (id) members.get(id)!.push(item)
    }
    const small = active.filter((id) => members.get(id)!.length < config.minPlaces)
    // Primero los que ni solos llegarían al mínimo; si no hay, el más chico (a igual tamaño, el de menor prioridad).
    const hopeless = small.filter((id) => rest.filter((item) => fits(id, item)).length < config.minPlaces)
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
  const chosen = active
    .map((id) => ({ id, items: members.get(id)!, avgScore: average(members.get(id)!) }))
    .sort((a, b) => b.avgScore - a.avgScore)
  const debug = { chosen: chosen.map(({ id, items: group, avgScore }) => ({ id, count: group.length, avgScore })), dropped }
  if (chosen.length === 0) return { sections: null, ...debug }

  const grouped = new Set(chosen.flatMap((group) => group.items))
  const more = rest.filter((item) => !grouped.has(item))
  const ids = (group: Fused[]) => group.map((item) => item.row.id)
  const sections: Section[] = [
    { id: 'top', title: TITLES.top[lang], placeIds: ids(top) },
    ...chosen.map((group) => ({ id: group.id, title: SECTIONS[group.id].title[lang], placeIds: ids(group.items) })),
    ...(more.length ? [{ id: 'more' as const, title: TITLES.more[lang], placeIds: ids(more) }] : []),
  ]
  return { sections, ...debug }
}
