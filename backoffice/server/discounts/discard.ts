import { fold } from '../../src/lib/discount-names.ts'

// Descarte automático por rubro (config/discount-sources.json → autoDiscard.categories). Puro.

/**
 * Si el rubro de la fuente también dice algo para salir a comer o tomar algo, no se descarta aunque nombre un rubro de la
 * lista ("Vinería y restaurante", "librerias, cafeteria", "Carnicería y parrilla").
 */
const GASTRONOMY_WORDS = ['restaurante', 'restaurant', 'restaurantes', 'cafeteria', 'cafe', 'bar', 'pub', 'heladeria', 'pizzeria', 'parrilla', 'confiteria']

const words = (value: string) => ` ${fold(value).replace(/[^a-z0-9]+/g, ' ').trim()} `
const hasWords = (text: string, phrase: string) => text.includes(words(phrase))

/** "Rubro: Carnicería" si el rubro de la fuente nombra uno de la lista (palabras completas, sin tildes); si no, null. */
export function discardReason(category: string | null, rules: readonly string[]): string | null {
  if (!category || rules.length === 0) return null
  const text = words(category)
  if (GASTRONOMY_WORDS.some((word) => hasWords(text, word))) return null
  const rule = rules.find((item) => hasWords(text, item))
  return rule ? `Rubro: ${rule}` : null
}
