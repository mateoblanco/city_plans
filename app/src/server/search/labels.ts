import { label, type OccasionTag, type StyleId } from '@shared/tags.ts'
import type { DietKey, Lang, Price } from './interpretation'
import { SEARCH_CONFIG } from './config'
import type { Moment, NextOpening, OpenState } from './hours'

export const DAY_NAMES: Record<Lang, string[]> = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

export const PRICE_LABELS: Record<Lang, Record<Price, string>> = {
  es: { low: 'Barato', moderate: 'Precio medio', high: 'Caro', very_high: 'Muy caro' },
  en: { low: 'Inexpensive', moderate: 'Moderate', high: 'Expensive', very_high: 'Very expensive' },
}

/** Un momento pedido, dicho como motivo: "Para ir con amigos" en lugar de "Grupos". */
export const MOMENT_REASON: Record<Lang, Record<OccasionTag, string>> = {
  es: { groups: 'Para ir con amigos', date: 'Para una cita', kids_friendly: 'Para ir con niños', celebration: 'Para festejar', quick: 'Algo rápido' },
  en: { groups: 'Good with friends', date: 'Good for a date', kids_friendly: 'Good with kids', celebration: 'Good to celebrate', quick: 'Quick bite' },
}

/** El estilo como motivo; intermedio no dice nada y no se muestra. */
export const STYLE_REASON: Record<Lang, Partial<Record<StyleId, string>>> = {
  es: { casual: 'Descontracturado', cuidado: 'Ambiente cuidado' },
  en: { casual: 'Laid-back', cuidado: 'Refined' },
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

/** "400 m", "1,2 km": hasta 1 km de a 100 m; después en km con un decimal. */
export function distanceText(meters: number, lang: Lang) {
  if (meters < 950) return `${Math.max(100, Math.round(meters / 100) * 100)} m`
  const km = Math.round(meters / 100) / 10
  return `${km.toLocaleString(lang === 'es' ? 'es-UY' : 'en-US', { maximumFractionDigits: 1 })} km`
}

/** Motivo de un resultado con "cerca mío": "a 400 m" / "400 m away". */
export function distanceLabel(meters: number, lang: Lang) {
  return lang === 'es' ? `a ${distanceText(meters, lang)}` : `${distanceText(meters, lang)} away`
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export function momentLabel(moment: Moment | 'now', lang: Lang, today: number) {
  if (moment === 'now') return lang === 'es' ? 'Abierto ahora' : 'Open now'
  const day = moment.day === today ? (lang === 'es' ? 'hoy' : 'today') : DAY_NAMES[lang][moment.day]
  return capitalize(moment.time ? `${day} ${moment.time}` : day)
}

/** "19:00", "9:00": sin el cero adelante. */
const clock = (time: string) => time.replace(/^0(\d)/, '$1')

/** "Abre 19:00", "Abre mañana 9:00", "Abre el lunes 12:00". */
function opensLabel(next: NextOpening, lang: Lang) {
  const es = lang === 'es'
  const time = clock(next.opens)
  if (next.daysAhead === 0) return es ? `Abre ${time}` : `Opens ${time}`
  if (next.daysAhead === 1) return es ? `Abre mañana ${time}` : `Opens tomorrow ${time}`
  return es ? `Abre el ${DAY_NAMES.es[next.day]} ${time}` : `Opens ${DAY_NAMES.en[next.day]} ${time}`
}

/** Abierto, cerrado y los dos "pronto" (sólo ahora, dentro de SEARCH_CONFIG.soonMinutes). */
export type OpenTone = 'open' | 'closing_soon' | 'opening_soon' | 'closed' | 'unconfirmed'

/** La etiqueta en partes, para que la card le dé color sólo al estado: prefijo, estado y horario. */
export type OpenStateText = { tone: OpenTone; prefix: string; status: string; detail: string | null }

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))

/** Minutos desde `from` hasta `to`, pasando la medianoche si hace falta. */
const minutesUntil = (from: string, to: string) => (minutes(to) - minutes(from) + 24 * 60) % (24 * 60)

/**
 * "Abierto · cierra 23:00", "Cierra pronto · 23:00", "Cerrado · Abre mañana 9:00", "Abre pronto · 19:00",
 * "Horario no confirmado"; con prefijo de día si no es ahora. `next` (próxima apertura) sólo se usa ahora.
 */
export function openStateText(state: OpenState, lang: Lang, moment: Moment, isNow: boolean, next: NextOpening | null = null): OpenStateText {
  const es = lang === 'es'
  if (state.state === 'unconfirmed') return { tone: 'unconfirmed', prefix: '', status: es ? 'Horario no confirmado' : 'Hours not confirmed', detail: null }
  const prefix = isNow ? '' : `${capitalize(DAY_NAMES[lang][moment.day])}${moment.time ? ` ${moment.time}` : ''}: `
  const soon = SEARCH_CONFIG.soonMinutes
  if (state.state === 'closed') {
    if (!isNow) return { tone: 'closed', prefix, status: es ? 'cerrado' : 'closed', detail: null }
    if (next && moment.time && next.daysAhead * 24 * 60 + minutes(next.opens) - minutes(moment.time) <= soon) {
      return { tone: 'opening_soon', prefix, status: es ? 'Abre pronto' : 'Opening soon', detail: clock(next.opens) }
    }
    return { tone: 'closed', prefix, status: es ? 'Cerrado' : 'Closed', detail: next ? opensLabel(next, lang) : null }
  }
  if (moment.time === null && state.opensAt) {
    const range = state.closesAt ? `${state.opensAt}–${state.closesAt}` : `${es ? 'desde las' : 'from'} ${state.opensAt}`
    return { tone: 'open', prefix, status: es ? `abre ${range}` : `open ${range}`, detail: null }
  }
  if (isNow && moment.time && state.closesAt && minutesUntil(moment.time, state.closesAt) <= soon) {
    return { tone: 'closing_soon', prefix, status: es ? 'Cierra pronto' : 'Closing soon', detail: clock(state.closesAt) }
  }
  const open = isNow ? (es ? 'Abierto' : 'Open') : es ? 'abierto' : 'open'
  return { tone: 'open', prefix, status: open, detail: state.closesAt ? `${es ? 'cierra' : 'closes'} ${state.closesAt}` : null }
}

/** La etiqueta entera, como texto: la usan los motivos. */
export function openStateLabel(state: OpenState, lang: Lang, moment: Moment, isNow: boolean, next: NextOpening | null = null): string {
  const text = openStateText(state, lang, moment, isNow, next)
  return text.prefix + (text.detail ? `${text.status} · ${text.detail}` : text.status)
}
