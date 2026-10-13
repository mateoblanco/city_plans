import { findDef, groupOf, label, normalize, toCanonical, type Lang } from '@shared/tags.ts'
import type { Dish } from './interpretation'

// Categorías que implican tener la comida del tag, para los lugares que no la tienen como tag.
const CATEGORY_FOR_FOOD: Record<string, string> = {
  pizza: 'pizzeria',
  chivito: 'chiviteria',
  grilled_meat: 'grill',
  ice_cream: 'ice_cream_shop',
  pastries: 'bakery',
}

/** Variantes para buscar en el diccionario: tal cual y sin plural. */
export function singularForms(phrase: string): string[] {
  const forms = [phrase]
  if (phrase.endsWith('es')) forms.push(phrase.slice(0, -2))
  if (phrase.endsWith('s')) forms.push(phrase.slice(0, -1))
  return forms
}

export function canonicalOf(phrase: string) {
  for (const form of singularForms(phrase)) {
    const found = toCanonical(form)
    if (found) return found
  }
  return null
}

export type DishTarget = {
  dish: string
  /** Tag de comida o bebida relacionado (ej. milanesa para "milanesa napolitana"). */
  tag: string | null
  category: string | null
  /** El plato es el tag mismo ("pizza", "chivitos"): tener el tag ya cuenta como tenerlo. */
  generic: boolean
  /** Tags y categorías para buscar si ningún lugar tiene el plato: el tag propio más los que mandó el modelo. */
  related: { tags: string[]; categories: string[] }
}

/** Tag relacionado con un plato: el plato entero o, si no, la palabra más larga del principio que sea comida. */
export function dishTarget(dish: string): DishTarget {
  const words = normalize(dish).split(' ')
  for (let length = words.length; length >= 1; length--) {
    const found = canonicalOf(words.slice(0, length).join(' '))
    if (!found || (found.group !== 'foods' && found.group !== 'drinks')) continue
    const definition = findDef(found.id)
    const generic =
      length === words.length &&
      singularForms(normalize(dish)).some((form) =>
        [found.id, definition?.label.es ?? '', definition?.label.en ?? ''].some((name) => singularForms(normalize(name)).includes(form)),
      )
    const category = CATEGORY_FOR_FOOD[found.id] ?? null
    return { dish, tag: found.id, category, generic, related: { tags: [found.id], categories: category ? [category] : [] } }
  }
  return { dish, tag: null, category: null, generic: false, related: { tags: [], categories: [] } }
}

/** dishTarget() más los tags relacionados de la interpretación. */
export function dishTargetFor(dish: Dish): DishTarget {
  const target = dishTarget(dish.name)
  return {
    ...target,
    related: {
      tags: [...new Set([...target.related.tags, ...dish.relatedTags])],
      categories: [...new Set([...target.related.categories, ...dish.relatedCategories])],
    },
  }
}

/** Hay tags relacionados más allá del tag propio del plato (que ya se buscó en el primer intento). */
export function hasBroaderRelated(target: DishTarget) {
  return (
    target.related.tags.some((id) => id !== target.tag) ||
    target.related.categories.some((id) => id !== target.category)
  )
}

/** "Cocina peruana" / "Peruvian cuisine" para cocinas; el label tal cual para lo demás. */
export function relatedLabel(id: string, lang: Lang) {
  const text = label(id, lang)
  if (groupOf(id) !== 'cuisines') return text
  return lang === 'es' ? `Cocina ${text.toLowerCase()}` : `${text} cuisine`
}

