import { label } from '@shared/tags.ts'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { DIET_KEYS, type ChipKind, type Interpretation } from './interpretation'
import { dietLabel, momentLabel, PRICE_LABELS } from './labels'

export type Chip = { kind: ChipKind; id: string; label: string }

/** Lo que se entendió de la consulta, en el orden en que conviene mostrarlo. El id es el que acepta `remove`. */
export function buildChips(value: Interpretation, today: number): Chip[] {
  const lang = value.language
  const chips: Chip[] = []
  if (value.nameQuery) chips.push({ kind: 'name', id: value.nameQuery, label: `“${value.nameQuery}”` })
  for (const id of value.must.categories) chips.push({ kind: 'category', id, label: label(id, lang) })
  for (const dish of value.dishes) chips.push({ kind: 'dish', id: dish.name, label: dish.name })
  for (const key of DIET_KEYS) if (value.must.diet[key]) chips.push({ kind: 'diet', id: key, label: dietLabel(key, lang) })
  for (const id of value.must.tags) chips.push({ kind: 'tag', id, label: label(id, lang) })
  for (const id of value.must.neighborhoods) chips.push({ kind: 'neighborhood', id, label: neighborhoodDisplayName(id) ?? id })
  for (const price of value.must.price) chips.push({ kind: 'price', id: price, label: PRICE_LABELS[lang][price] })
  if (value.must.openAt) {
    const openAt = value.must.openAt
    const moment = openAt === 'now' ? 'now' : { day: openAt.day ?? today, time: openAt.time }
    chips.push({ kind: 'openAt', id: openAt === 'now' ? 'now' : 'day', label: momentLabel(moment, lang, today) })
  }
  for (const id of [...value.prefer.categories, ...value.prefer.tags]) chips.push({ kind: 'prefer', id, label: label(id, lang) })
  for (const id of [...value.exclude.categories, ...value.exclude.tags]) {
    chips.push({ kind: 'exclude', id, label: `${lang === 'es' ? 'Sin' : 'No'} ${label(id, lang).toLowerCase()}` })
  }
  if (value.vibe) chips.push({ kind: 'vibe', id: 'vibe', label: value.vibe })
  return chips
}
