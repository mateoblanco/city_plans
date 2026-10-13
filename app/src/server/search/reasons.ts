import { label } from '@shared/tags.ts'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import type { DishMode } from './candidates'
import { relatedLabel, type DishTarget } from './dishes'
import type { Fused } from './fuse'
import type { Moment, OpenState } from './hours'
import { DIET_KEYS, type Interpretation } from './interpretation'
import { dietLevelLabel, openStateLabel } from './labels'

export type ReasonContext = {
  interpretation: Interpretation
  dishes: DishTarget[]
  dishMode: DishMode
  /** Momento con el que se muestra el horario: el de openAt o ahora. */
  moment: Moment
  isNow: boolean
  open: OpenState
}

/** Motivos de un resultado, armados desde los datos y en el idioma de la consulta. */
export function buildReasons(item: Fused, context: ReasonContext): string[] {
  const { row } = item
  const { interpretation } = context
  const lang = interpretation.language
  const es = lang === 'es'
  const reasons: string[] = []

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

  for (const key of DIET_KEYS) {
    if (!interpretation.must.diet[key]) continue
    const text = dietLevelLabel(key, row.diet[key], lang)
    if (text) reasons.push(text)
  }

  const wantedCategories = [...interpretation.must.categories, ...interpretation.prefer.categories]
  const wantedTags = [...interpretation.must.tags, ...interpretation.prefer.tags]
  for (const id of row.categories) if (wantedCategories.includes(id)) reasons.push(label(id, lang))
  for (const id of row.tags) if (wantedTags.includes(id)) reasons.push(label(id, lang))

  reasons.push(openStateLabel(context.open, lang, context.moment, context.isNow))
  const neighborhood = neighborhoodDisplayName(row.neighborhoodId)
  if (neighborhood) reasons.push(neighborhood)
  return [...new Set(reasons)]
}
