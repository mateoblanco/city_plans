import { label } from '@shared/tags.ts'
import type { DietKey, Lang, Price } from './interpretation'
import type { Moment, OpenState } from './hours'

export const DAY_NAMES: Record<Lang, string[]> = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

export const PRICE_LABELS: Record<Lang, Record<Price, string>> = {
  es: { low: 'Barato', moderate: 'Precio medio', high: 'Caro', very_high: 'Muy caro' },
  en: { low: 'Inexpensive', moderate: 'Moderate', high: 'Expensive', very_high: 'Very expensive' },
}

const DIET_TAG: Record<DietKey, string> = { vegan: 'vegan', vegetarian: 'vegetarian', glutenFree: 'gluten_free' }

export function dietLabel(key: DietKey, lang: Lang) {
  return label(DIET_TAG[key], lang)
}

/** Texto de un nivel de dieta conocido: "Opciones veganas" / "100 % vegano". */
export function dietLevelLabel(key: DietKey, level: string, lang: Lang): string | null {
  const texts: Record<Lang, Record<DietKey, [string, string]>> = {
    es: { vegan: ['Opciones veganas', '100 % vegano'], vegetarian: ['Opciones vegetarianas', '100 % vegetariano'], glutenFree: ['Opciones sin TACC', 'Todo sin TACC'] },
    en: { vegan: ['Vegan options', 'Fully vegan'], vegetarian: ['Vegetarian options', 'Fully vegetarian'], glutenFree: ['Gluten-free options', 'Fully gluten-free'] },
  }
  if (level === 'has_options') return texts[lang][key][0]
  if (level === 'fully') return texts[lang][key][1]
  return null
}

// Las categorías excluidas se leen en plural: "Excepto restaurantes".
const CATEGORY_PLURALS: Record<Lang, Record<string, string>> = {
  es: {
    restaurant: 'restaurantes', cafe: 'cafés', bar: 'bares', brewery: 'cervecerías', wine_bar: 'vinotecas', bakery: 'panaderías',
    ice_cream_shop: 'heladerías', grill: 'parrillas', chiviteria: 'chiviterías', pizzeria: 'pizzerías', night_club: 'boliches', bodegon: 'bodegones',
  },
  en: {
    restaurant: 'restaurants', cafe: 'cafés', bar: 'bars', brewery: 'breweries', wine_bar: 'wine bars', bakery: 'bakeries',
    ice_cream_shop: 'ice cream shops', grill: 'steakhouses', chiviteria: 'chivito spots', pizzeria: 'pizzerias', night_club: 'night clubs', bodegon: 'bodegones',
  },
}

/** Lo excluido, en minúscula: "restaurantes", "pizza". */
export function excludedTerm(id: string, lang: Lang) {
  return CATEGORY_PLURALS[lang][id] ?? label(id, lang).toLowerCase()
}

/** Chip de exclusión: "Excepto restaurantes" / "Except restaurants". */
export function excludeLabel(id: string, lang: Lang) {
  return `${lang === 'es' ? 'Excepto' : 'Except'} ${excludedTerm(id, lang)}`
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function momentLabel(moment: Moment | 'now', lang: Lang, today: number) {
  if (moment === 'now') return lang === 'es' ? 'Abierto ahora' : 'Open now'
  const day = moment.day === today ? (lang === 'es' ? 'hoy' : 'today') : DAY_NAMES[lang][moment.day]
  return capitalize(moment.time ? `${day} ${moment.time}` : day)
}

/** "Abierto · cierra 23:00", "Horario no confirmado"; con prefijo de día si no es ahora. */
export function openStateLabel(state: OpenState, lang: Lang, moment: Moment, isNow: boolean): string {
  const es = lang === 'es'
  if (state.state === 'unconfirmed') return es ? 'Horario no confirmado' : 'Hours not confirmed'
  const prefix = isNow ? '' : `${capitalize(DAY_NAMES[lang][moment.day])}${moment.time ? ` ${moment.time}` : ''}: `
  if (state.state === 'closed') return prefix + (es ? (isNow ? 'Cerrado ahora' : 'cerrado') : isNow ? 'Closed now' : 'closed')
  if (moment.time === null && state.opensAt) {
    const range = state.closesAt ? `${state.opensAt}–${state.closesAt}` : `${es ? 'desde las' : 'from'} ${state.opensAt}`
    return prefix + (es ? `abre ${range}` : `open ${range}`)
  }
  const open = isNow ? (es ? 'Abierto' : 'Open') : es ? 'abierto' : 'open'
  return prefix + (state.closesAt ? `${open} · ${es ? 'cierra' : 'closes'} ${state.closesAt}` : open)
}
