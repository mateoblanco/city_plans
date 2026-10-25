import { buildEmbeddingText, buildKeywordText, type StyleId, type TagId } from '../../src/data/tags.ts'
import type { ManualOverrides, PlaceEdit } from '../../src/data/manual-overrides.ts'
import { searchTextInput } from '../providers/place-extraction-service.ts'
import type { NewPlace, Place } from '../db/schema.ts'

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
} as const satisfies Partial<Record<keyof ManualOverrides, keyof NewPlace>>

const LOGO_COLUMNS = ['logoKey', 'logoKind', 'logoBgColor', 'logoColor', 'logoSource', 'logoFetchedAt'] as const

// Lo que entra en los textos de búsqueda: si alguno tiene override, los textos del borrador no sirven.
const SEARCH_OVERRIDES = ['name', 'tags', 'style', 'diet_vegan', 'diet_vegetarian', 'diet_gluten_free'] as const

/** Tags finales: los automáticos sin los sacados a mano, más los agregados. */
export function applyTagDiff(auto: readonly string[], diff: ManualOverrides['tags']): string[] {
  if (!diff) return [...auto]
  const removed = new Set<string>(diff.remove)
  return [...new Set([...auto.filter((id) => !removed.has(id)), ...diff.add])]
}

/**
 * Pone los overrides manuales encima de valores automáticos. Única función que lo hace: la usan la re-extracción
 * (savePlaces), extraction:replay, signals:refresh, prominence:recompute y brands:backfill. Sólo toca las claves que
 * vienen en `auto`, así un camino que escribe tres columnas sigue escribiendo esas tres. Con tags, también saca de
 * signature los tags que se sacaron a mano.
 */
export function applyOverrides<T extends Partial<NewPlace>>(auto: T, overrides: ManualOverrides): T {
  const result: Partial<NewPlace> = { ...auto }
  for (const [field, column] of Object.entries(SCALAR_COLUMNS) as [keyof typeof SCALAR_COLUMNS, keyof NewPlace][]) {
    if (Object.hasOwn(auto, column) && Object.hasOwn(overrides, field)) (result as Record<string, unknown>)[column] = overrides[field]
  }
  if (overrides.logo && LOGO_COLUMNS.some((column) => Object.hasOwn(auto, column))) {
    const { key, kind, bgColor, color, source, fetchedAt } = overrides.logo
    Object.assign(result, { logoKey: key, logoKind: kind, logoBgColor: bgColor, logoColor: color, logoSource: source, logoFetchedAt: new Date(fetchedAt) })
  }
  if (overrides.tags && auto.tags) {
    const tags = applyTagDiff(auto.tags, overrides.tags)
    result.tags = tags
    if (auto.signature) result.signature = auto.signature.filter((id) => tags.includes(id))
  }
  return result as T
}

/** Si algún override cambia lo que entra en los textos de búsqueda (nombre, tags, style o dietas). */
export function overridesAffectSearch(overrides: ManualOverrides) {
  return SEARCH_OVERRIDES.some((field) => Object.hasOwn(overrides, field))
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
  'instagram' | 'website' | 'brandKey'>

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
    if (key === 'tags') {
      if (!sameTags(current.tags, value as string[])) changed.push(key)
    } else if (key === 'instagram') {
      if (handleOf(current.instagram) !== value) changed.push(key)
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
 * tag automático que se había sacado lo quita de remove. featured no va: ningún camino automático lo escribe.
 */
export function mergeEdit(overrides: ManualOverrides, current: EditableValues, edit: PlaceEdit): ManualOverrides {
  const next: ManualOverrides = { ...overrides }
  const changed = new Set(changedEditFields(current, edit))
  for (const [key, field] of Object.entries(EDIT_TO_OVERRIDE) as [keyof typeof EDIT_TO_OVERRIDE, keyof typeof SCALAR_COLUMNS][]) {
    if (changed.has(key)) (next as Record<string, unknown>)[field] = edit[key]
  }
  if (edit.logo) next.logo = edit.logo
  if (edit.tags && changed.has('tags')) {
    const added = edit.tags.filter((id) => !current.tags.includes(id))
    const removed = current.tags.filter((id) => !edit.tags!.includes(id as TagId)) as TagId[]
    const previous = overrides.tags ?? { add: [], remove: [] }
    const add = [...new Set([...previous.add.filter((id) => !removed.includes(id)), ...added])]
    const remove = [...new Set([...previous.remove.filter((id) => !added.includes(id)), ...removed])]
    if (add.length > 0 || remove.length > 0) next.tags = { add, remove }
    else delete next.tags
  }
  return next
}
