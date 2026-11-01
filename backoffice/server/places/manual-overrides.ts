import { buildEmbeddingText, buildKeywordText, type StyleId, type TagId } from '../../src/data/tags.ts'
import { normalizeDish, textKey, type ManualOverrides, type PlaceEdit } from '../../src/data/manual-overrides.ts'
import { sameSlots, sortedSlots, type ManualSlot } from '../../src/data/hours-edit.ts'
import { displayFromSlots, lateNightFromSlots, searchTextInput } from '../providers/place-extraction-service.ts'
import type { Hours, NewPlace, Place } from '../db/schema.ts'
import { computeProminence } from './prominence.ts'

// Overrides de un valor: clave de manual_overrides (columna SQL) → key de Drizzle.
const SCALAR_COLUMNS = {
  status: 'status',
  review_reasons: 'reviewReasons',
  name: 'name',
  style: 'style',
  icon_category: 'iconCategory',
  price: 'price',
  diet_vegan: 'dietVegan',
  diet_vegetarian: 'dietVegetarian',
  diet_gluten_free: 'dietGlutenFree',
  instagram: 'instagram',
  website: 'website',
  brand_key: 'brandKey',
  chain_branch: 'chainBranch',
  categories: 'categories',
  neighborhood_id: 'neighborhoodId',
  located_in: 'locatedIn',
  reservations: 'reservations',
  highlights: 'highlights',
} as const satisfies Partial<Record<keyof ManualOverrides, keyof NewPlace>>

const LOGO_COLUMNS = ['logoKey', 'logoKind', 'logoBgColor', 'logoColor', 'logoSource', 'logoFetchedAt'] as const

/** Columna hours de un horario cargado a mano: exacto, con display (es/en) y raw armados desde los turnos. */
export function hoursFromSlots(slots: readonly ManualSlot[]): Hours {
  const sorted = sortedSlots(slots)
  const display = displayFromSlots(sorted)
  return { raw: display?.es ?? null, display, slots: sorted, status: 'exact', source: 'manual', missingReason: null }
}

/** late_night según los turnos: se agrega o se saca (sólo depende del horario). */
export function withLateNight(tags: readonly string[], slots: readonly ManualSlot[]): string[] {
  const rest = tags.filter((id) => id !== 'late_night')
  return lateNightFromSlots(slots) ? [...rest, 'late_night'] : rest
}

/** Tags finales: los automáticos sin los sacados a mano, más los agregados. */
export function applyTagDiff(auto: readonly string[], diff: ManualOverrides['tags']): string[] {
  if (!diff) return [...auto]
  const removed = new Set<string>(diff.remove)
  return [...new Set([...auto.filter((id) => !removed.has(id)), ...diff.add])]
}

/** Platos finales: los automáticos sin los sacados a mano, más los agregados (comparados en minúscula). */
export function applyDishDiff(auto: readonly string[], diff: ManualOverrides['dishes']): string[] {
  if (!diff) return [...auto]
  const removed = new Set(diff.remove.map(normalizeDish))
  const kept = auto.filter((dish) => !removed.has(normalizeDish(dish)))
  const seen = new Set(kept.map(normalizeDish))
  return [...kept, ...diff.add.filter((dish) => !seen.has(normalizeDish(dish)) && seen.add(normalizeDish(dish)))]
}

/** Destacados del modal (sólo es): el en se conserva del que quedó igual; los nuevos van sin en. */
export function highlightsFromEdit(current: readonly { es: string; en: string }[], edited: readonly string[]): { es: string; en: string }[] {
  const previous = new Map(current.map((highlight) => [textKey(highlight.es), highlight.en]))
  return edited.map((es) => ({ es, en: previous.get(textKey(es)) ?? '' }))
}

/**
 * Pone los overrides manuales encima de valores automáticos. Única función que lo hace: la usan la re-extracción
 * (savePlaces), extraction:replay, signals:refresh, prominence:recompute y brands:backfill. Sólo toca las claves que
 * vienen en `auto`, así un camino que escribe tres columnas sigue escribiendo esas tres. Con tags, también saca de
 * signature los tags que se sacaron a mano; un signature a mano manda, sin los tags que ya no están. Los platos, como
 * los tags, con la diferencia. Con el horario a mano, late_night sale de esos turnos (antes del diff de tags,
 * así un late_night sacado o agregado a mano sigue mandando). Con chain_branch a mano, la prominence que viene se recalcula con ese valor
 * (si hay seguidores): el ×0,85 sigue al override.
 */
export function applyOverrides<T extends Partial<NewPlace>>(auto: T, overrides: ManualOverrides): T {
  const result: Partial<NewPlace> = { ...auto }
  for (const [field, column] of Object.entries(SCALAR_COLUMNS) as [keyof typeof SCALAR_COLUMNS, keyof NewPlace][]) {
    if (Object.hasOwn(auto, column) && Object.hasOwn(overrides, field)) (result as Record<string, unknown>)[column] = overrides[field]
  }
  if (overrides.hours && Object.hasOwn(auto, 'hours')) result.hours = hoursFromSlots(overrides.hours.slots)
  if (overrides.logo && LOGO_COLUMNS.some((column) => Object.hasOwn(auto, column))) {
    const { key, kind, bgColor, color, source, fetchedAt } = overrides.logo
    Object.assign(result, { logoKey: key, logoKind: kind, logoBgColor: bgColor, logoColor: color, logoSource: source, logoFetchedAt: new Date(fetchedAt) })
  }
  // Sin seguidores no hace falta: vale la mediana con o sin cadena, y la prominence que viene ya es esa.
  if (Object.hasOwn(overrides, 'chain_branch') && Object.hasOwn(auto, 'prominence') && typeof auto.igFollowers === 'number') {
    result.prominence = computeProminence({ igFollowers: auto.igFollowers, chainBranch: overrides.chain_branch }, auto.prominence ?? 0)
  }
  const autoTags = auto.tags && overrides.hours ? withLateNight(auto.tags, overrides.hours.slots) : auto.tags
  if (autoTags !== auto.tags) result.tags = autoTags as string[]
  if (overrides.tags && autoTags) {
    const tags = applyTagDiff(autoTags, overrides.tags)
    result.tags = tags
    if (auto.signature) result.signature = auto.signature.filter((id) => tags.includes(id))
  }
  if (overrides.signature && Object.hasOwn(auto, 'signature')) {
    const tags = result.tags ?? auto.tags
    result.signature = tags ? overrides.signature.filter((id) => tags.includes(id)) : [...overrides.signature]
  }
  if (overrides.dishes && auto.dishes) result.dishes = applyDishDiff(auto.dishes, overrides.dishes)
  return result as T
}


/** Lo que hace falta de un lugar para armar sus textos de búsqueda. */
export type SearchTextValues = Pick<Place,
  'name' | 'neighborhoodId' | 'descriptionEs' | 'descriptionEn' | 'locatedIn' | 'categories' | 'tags' |
  'dietVegan' | 'dietVegetarian' | 'dietGlutenFree' | 'highlights' | 'dishes' | 'signature' | 'style'>

/** keyword_text y embedding_text desde los valores finales del lugar (search_tsv sale de keyword_text y del nombre). */
export function placeSearchTexts(values: SearchTextValues): { keywordText: string; embeddingText: string } {
  const input = searchTextInput({
    name: values.name,
    neighborhoodId: values.neighborhoodId,
    description: { es: values.descriptionEs ?? '', en: values.descriptionEn ?? '' },
    locatedIn: values.locatedIn,
    categories: values.categories,
    tags: values.tags,
    dietary: { vegan: values.dietVegan, vegetarian: values.dietVegetarian, glutenFree: values.dietGlutenFree },
    highlights: values.highlights,
    dishes: values.dishes,
    signature: values.signature,
    style: values.style as StyleId | null,
  })
  return { keywordText: buildKeywordText(input), embeddingText: buildEmbeddingText(input) }
}

/** Valores de los campos editables tal como están guardados (los finales). */
export type EditableValues = Pick<Place,
  'name' | 'tags' | 'style' | 'iconCategory' | 'price' | 'dietVegan' | 'dietVegetarian' | 'dietGlutenFree' |
  'instagram' | 'website' | 'brandKey' | 'chainBranch' | 'hours' | 'dishes' | 'signature' | 'highlights' | 'categories' |
  'neighborhoodId' | 'locatedIn' | 'reservations'>

// Campo del modal → clave de manual_overrides.
const EDIT_TO_OVERRIDE = {
  name: 'name',
  style: 'style',
  iconCategory: 'icon_category',
  price: 'price',
  dietVegan: 'diet_vegan',
  dietVegetarian: 'diet_vegetarian',
  dietGlutenFree: 'diet_gluten_free',
  instagram: 'instagram',
  website: 'website',
  brandKey: 'brand_key',
  chainBranch: 'chain_branch',
  signature: 'signature',
  categories: 'categories',
  neighborhoodId: 'neighborhood_id',
  locatedIn: 'located_in',
  reservations: 'reservations',
} as const satisfies Partial<Record<keyof PlaceEdit, keyof ManualOverrides>>

const sameTags = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((id) => right.includes(id))

/** Handle sin @ ni mayúsculas, para comparar con lo guardado. */
const handleOf = (value: string | null) => value?.replace(/^@/, '').trim().toLowerCase() || null

/** Campos del modal que de verdad cambian respecto de lo guardado. */
export function changedEditFields(current: EditableValues, edit: PlaceEdit): (keyof PlaceEdit)[] {
  const changed: (keyof PlaceEdit)[] = []
  for (const key of Object.keys(edit) as (keyof PlaceEdit)[]) {
    const value = edit[key]
    if (value === undefined) continue
    if (key === 'tags' || key === 'signature' || key === 'categories') {
      if (!sameTags(current[key], value as string[])) changed.push(key)
    } else if (key === 'dishes') {
      if (!sameTags(current.dishes.map(normalizeDish), edit.dishes!.map(normalizeDish))) changed.push(key)
    } else if (key === 'highlights') {
      const before = current.highlights.map((highlight) => highlight.es)
      if (before.length !== edit.highlights!.length || before.some((es, index) => es !== edit.highlights![index])) changed.push(key)
    } else if (key === 'instagram') {
      if (handleOf(current.instagram) !== value) changed.push(key)
    } else if (key === 'hours') {
      if (current.hours.source !== 'manual' || !sameSlots(current.hours.slots, edit.hours!.slots)) changed.push(key)
    } else if (key === 'logo' || key === 'featured') {
      changed.push(key)
    } else if ((current as Record<string, unknown>)[key] !== value) {
      changed.push(key)
    }
  }
  return changed
}

/**
 * manual_overrides después de una edición. Los campos de un valor que cambiaron guardan el valor nuevo. Los tags
 * guardan la diferencia: los agregados entran en add y salen de remove, y los sacados al revés; volver a poner un
 * tag automático que se había sacado lo quita de remove; los platos igual. Un tag sacado sale también del signature
 * guardado. featured no va: ningún camino automático lo escribe.
 */
export function mergeEdit(overrides: ManualOverrides, current: EditableValues, edit: PlaceEdit): ManualOverrides {
  const next: ManualOverrides = { ...overrides }
  const changed = new Set(changedEditFields(current, edit))
  for (const [key, field] of Object.entries(EDIT_TO_OVERRIDE) as [keyof typeof EDIT_TO_OVERRIDE, keyof typeof SCALAR_COLUMNS][]) {
    if (changed.has(key)) (next as Record<string, unknown>)[field] = edit[key]
  }
  if (edit.logo) next.logo = edit.logo
  if (edit.hours && changed.has('hours')) next.hours = { slots: sortedSlots(edit.hours.slots) }
  if (edit.tags && changed.has('tags')) {
    const added = edit.tags.filter((id) => !current.tags.includes(id))
    const removed = current.tags.filter((id) => !edit.tags!.includes(id as TagId)) as TagId[]
    const previous = overrides.tags ?? { add: [], remove: [] }
    const add = [...new Set([...previous.add.filter((id) => !removed.includes(id)), ...added])]
    const remove = [...new Set([...previous.remove.filter((id) => !added.includes(id)), ...removed])]
    if (add.length > 0 || remove.length > 0) next.tags = { add, remove }
    else delete next.tags
    if (next.signature) next.signature = next.signature.filter((id) => edit.tags!.includes(id))
  }
  if (edit.dishes && changed.has('dishes')) {
    const before = new Set(current.dishes.map(normalizeDish))
    const after = new Set(edit.dishes.map(normalizeDish))
    const added = [...after].filter((dish) => !before.has(dish))
    const removed = [...before].filter((dish) => !after.has(dish))
    const previous = overrides.dishes ?? { add: [], remove: [] }
    const add = [...new Set([...previous.add.filter((dish) => !removed.includes(dish)), ...added])]
    const remove = [...new Set([...previous.remove.filter((dish) => !added.includes(dish)), ...removed])]
    if (add.length > 0 || remove.length > 0) next.dishes = { add, remove }
    else delete next.dishes
  }
  if (edit.highlights && changed.has('highlights')) next.highlights = highlightsFromEdit(current.highlights, edit.highlights)
  return next
}
