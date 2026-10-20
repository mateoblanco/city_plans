import { CUISINES, DRINKS, FOODS, isOccasionTag, isStyleId, label } from '@shared/tags.ts'
import type { IntentId } from '@shared/intents.ts'
import type { DishMode } from './candidates'
import { relatedLabel, type DishTarget } from './dishes'
import type { Fused } from './fuse'
import { DIET_KEYS, type Interpretation } from './interpretation'
import { dietLevelLabel, distanceLabel, MOMENT_REASON, STYLE_REASON } from './labels'

export type ReasonContext = {
  interpretation: Interpretation
  dishes: DishTarget[]
  dishMode: DishMode
  /** Intención activa: con ella, lo que define al lugar dentro de esa intención (signature) también es motivo. */
  intent: IntentId | null
  /** Con "cerca mío": la distancia va entre los motivos. */
  near: boolean
}

/** Cuántos motivos muestra cada resultado. */
export const MAX_REASONS = 3

const NOT_BAR_DRINKS = new Set(['specialty_coffee', 'tea', 'non_alcoholic'])

/** Signature que dicen algo dentro de cada intención: los platos para Comer, las bebidas para Bares… */
const INTENT_SIGNATURE: Record<IntentId, Set<string>> = {
  eat: new Set([...Object.keys(FOODS), ...Object.keys(CUISINES)]),
  bars: new Set(Object.keys(DRINKS).filter((id) => !NOT_BAR_DRINKS.has(id))),
  cafes: new Set(['specialty_coffee', 'tea', 'pastries', 'brunch', 'afternoon_snack']),
  desserts: new Set(['desserts', 'ice_cream', 'pastries']),
}

/**
 * Motivos de un resultado, del más específico al más general y hasta MAX_REASONS: platos pedidos, lo que define
 * al lugar y coincide con la búsqueda (signature), dieta, otros tags pedidos, el estilo y el momento. El horario,
 * el barrio y las categorías no van: la card ya los muestra.
 */
export function buildReasons(item: Fused, context: ReasonContext): string[] {
  const { row } = item
  const { interpretation } = context
  const lang = interpretation.language
  const es = lang === 'es'
  const reasons: string[] = []
  if (row.featured) reasons.push(es ? 'Recomendado' : 'Recommended')

  context.dishes.forEach((target, index) => {
    const viaTag = (target.tag !== null && row.tags.includes(target.tag)) || (target.category !== null && row.categories.includes(target.category))
    if (row.dishHas[index] || (target.generic && viaTag)) reasons.push(es ? `Tiene ${target.dish}` : `Has ${target.dish}`)
    else if (viaTag) reasons.push(es ? `Puede que tengan ${target.dish}` : `May have ${target.dish}`)
  })
  // Sin el plato en ningún lugar: por qué aparece este (cocina peruana, mariscos…).
  if (context.dishMode === 'related') {
    const related = new Set(context.dishes.flatMap((target) => [...target.related.tags, ...target.related.categories]))
    for (const id of [...row.categories, ...row.tags]) if (related.has(id)) reasons.push(relatedLabel(id, lang))
  }
  if (context.near && row.distance !== null) reasons.push(distanceLabel(row.distance, lang))

  const wantedTags = [...interpretation.must.tags, ...interpretation.prefer.tags]
  const wanted = new Set([...interpretation.must.categories, ...interpretation.prefer.categories, ...wantedTags])
  const domain = context.intent ? INTENT_SIGNATURE[context.intent] : new Set<string>()
  for (const id of row.signature) if (wanted.has(id) || domain.has(id)) reasons.push(label(id, lang))

  for (const key of DIET_KEYS) {
    if (!interpretation.must.diet[key]) continue
    const text = dietLevelLabel(key, row.diet[key], lang)
    if (text) reasons.push(text)
  }

  for (const id of row.tags) if (wantedTags.includes(id) && !isOccasionTag(id)) reasons.push(label(id, lang))
  const style = row.style && isStyleId(row.style) ? STYLE_REASON[lang][row.style] : undefined
  if (style) reasons.push(style)
  for (const id of row.tags) if (wantedTags.includes(id) && isOccasionTag(id)) reasons.push(MOMENT_REASON[lang][id])
  return [...new Set(reasons)].slice(0, MAX_REASONS)
}
