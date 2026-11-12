import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import { ATMOSPHERE, CUISINES, DRINKS, FEATURES, FOODS, label, OFFERS, type OccasionTag, type StyleId } from '@shared/tags.ts'
import type { DietKey, Lang, Price } from './interpretation'
import { SEARCH_CONFIG } from './config'
import type { Moment, NextOpening, OpenState } from './hours'
import type { PlaceKind } from './personal'

/** Idioma de todo lo que se muestra. El detectado (interpretation.language) sólo sirve para interpretar la consulta. */
export const DISPLAY_LANG: Lang = 'es'

export const DAY_NAMES: Record<Lang, string[]> = {
  es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
}

export const PRICE_LABELS: Record<Lang, Record<Price, string>> = {
  es: { low: 'Accesible', moderate: 'Normal', high: 'Caro' },
  en: { low: 'Affordable', moderate: 'Moderate', high: 'Expensive' },
}

/** Los niveles del select de precio de la barra (los chips y motivos usan PRICE_LABELS). */
export const PRICE_FILTER_LABELS: Record<Price, string> = { low: 'Accesible', moderate: 'Normal', high: 'Caro' }

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

/**
 * Título del grupo de los 100 % aptos para la dieta pedida: "Recomendados" (la búsqueda ya dice la dieta; los demás grupos
 * son lugares con opciones de esa dieta).
 */
export function dietGroupTitle(lang: Lang): string {
  return lang === 'es' ? 'Recomendados' : 'Recommended'
}

// Las categorías excluidas se leen en plural: "Excepto restaurantes".
const CATEGORY_PLURALS: Record<Lang, Record<string, string>> = {
  es: {
    restaurant: 'restaurantes', cafe: 'cafés', bar: 'bares', brewery: 'cervecerías', wine_bar: 'vinotecas', bakery: 'panaderías',
    ice_cream_shop: 'heladerías', grill: 'parrillas', chiviteria: 'chiviterías', pizzeria: 'pizzerías', bodegon: 'bodegones',
  },
  en: {
    restaurant: 'restaurants', cafe: 'cafés', bar: 'bars', brewery: 'breweries', wine_bar: 'wine bars', bakery: 'bakeries',
    ice_cream_shop: 'ice cream shops', grill: 'steakhouses', chiviteria: 'chivito spots', pizzeria: 'pizzerias', bodegon: 'bodegones',
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

export function momentLabel(moment: Moment | 'today', lang: Lang, today: number) {
  if (moment === 'today') return lang === 'es' ? 'Abre hoy' : 'Opens today'
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
 * "Horario sin confirmar"; con prefijo de día si no es ahora. `next` (próxima apertura) sólo se usa ahora.
 */
export function openStateText(state: OpenState, lang: Lang, moment: Moment, isNow: boolean, next: NextOpening | null = null): OpenStateText {
  const es = lang === 'es'
  if (state.state === 'unconfirmed') return { tone: 'unconfirmed', prefix: '', status: es ? 'Horario sin confirmar' : 'Hours not confirmed', detail: null }
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

/** Tipo de lugar de un perfil, en plural: "Porque te gustan los bares…". */
const KIND_NOUNS: Record<Lang, Record<PlaceKind, string>> = {
  es: { cafes: 'cafés', bars: 'bares', eat: 'restaurantes', desserts: 'lugares de postres' },
  en: { cafes: 'cafés', bars: 'bars', eat: 'restaurants', desserts: 'dessert places' },
}

/** Dónde va un rasgo en el motivo: "los bares {adj} {de} {con} {para} {en}". */
type TraitSlot = 'adj' | 'de' | 'con' | 'para' | 'en'
export type TraitPhrase = { slot: TraitSlot; text: string }

/** Los rasgos que no se dicen como "con {etiqueta}" (o que no son un tag), en masculino plural. */
const TRAIT_PHRASES: Record<string, TraitPhrase> = {
  'style:casual': { slot: 'adj', text: 'descontracturados' },
  'style:cuidado': { slot: 'con', text: 'ambiente cuidado' },
  'price:low': { slot: 'adj', text: 'accesibles' },
  'price:moderate': { slot: 'de', text: 'de precio normal' },
  'price:high': { slot: 'adj', text: 'caros' },
  breakfast: { slot: 'para', text: 'para desayunar' },
  brunch: { slot: 'para', text: 'para el brunch' },
  lunch: { slot: 'para', text: 'para almorzar' },
  afternoon_snack: { slot: 'para', text: 'para merendar' },
  dinner: { slot: 'para', text: 'para cenar' },
  drinks: { slot: 'para', text: 'para tomar algo' },
  late_night: { slot: 'para', text: 'para el trasnoche' },
  date: { slot: 'para', text: 'para una cita' },
  work: { slot: 'para', text: 'para trabajar' },
  after_office: { slot: 'para', text: 'para el after office' },
  groups: { slot: 'para', text: 'para ir en grupo' },
  kids_friendly: { slot: 'para', text: 'para ir con niños' },
  solo: { slot: 'para', text: 'para ir solo' },
  celebration: { slot: 'para', text: 'para festejar' },
  quick: { slot: 'para', text: 'para algo rápido' },
  outdoor: { slot: 'adj', text: 'al aire libre' },
  pet_friendly: { slot: 'adj', text: 'pet friendly' },
  accessible: { slot: 'adj', text: 'accesibles' },
  takeaway: { slot: 'para', text: 'para llevar' },
  bar_seating: { slot: 'para', text: 'para comer en la barra' },
  vegan: { slot: 'adj', text: 'veganos' },
  vegetarian: { slot: 'adj', text: 'vegetarianos' },
  gluten_free: { slot: 'adj', text: 'sin TACC' },
}

/** "Tranquilo" → "tranquilos", "Acogedor" → "acogedores"; "De barrio" queda igual. */
const pluralAdjective = (text: string) => {
  const lower = text.toLowerCase()
  if (lower.includes(' ')) return lower
  return /[aeiou]$/.test(lower) ? `${lower}s` : `${lower}es`
}

/** "Música en vivo" → "música en vivo"; las siglas ("DJ") quedan igual. */
const lowerFirst = (text: string) => (/^[A-Z]{2}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1))

/** Cómo se dice un rasgo del perfil (tag, `style:x`, `price:x` o `barrio:x`) en el motivo; null si no se dice. */
export function traitPhrase(key: string): TraitPhrase | null {
  if (Object.hasOwn(TRAIT_PHRASES, key)) return TRAIT_PHRASES[key]
  if (key.startsWith('barrio:')) return { slot: 'en', text: `en ${neighborhoodDisplayName(key.slice('barrio:'.length))}` }
  if (key.includes(':')) return null
  if (Object.hasOwn(ATMOSPHERE, key)) return { slot: 'adj', text: pluralAdjective(label(key, 'es')) }
  if (Object.hasOwn(CUISINES, key)) return { slot: 'de', text: `de cocina ${label(key, 'es').toLowerCase()}` }
  if ([FOODS, DRINKS, FEATURES, OFFERS].some((group) => Object.hasOwn(group, key))) return { slot: 'con', text: lowerFirst(label(key, 'es')) }
  return null
}

const SLOT_ORDER: TraitSlot[] = ['adj', 'de', 'con', 'para', 'en']

/**
 * Título del grupo del perfil, sin modelo: "Porque te gustan los bares de barrio con vermut". traits: los rasgos del
 * motivo, de mayor a menor peso; los del mismo lugar de la frase se unen con "y". Sin rasgos que se digan, "Porque te
 * gustan estos cafés".
 */
export function profileReasonTitle(kind: PlaceKind, traits: string[], lang: Lang): string {
  const noun = KIND_NOUNS[lang][kind]
  if (lang === 'en') return `Based on the ${noun} you like`
  const phrases = traits.flatMap((key) => traitPhrase(key) ?? [])
  if (!phrases.length) return `Porque te gustan estos ${noun}`
  const parts = SLOT_ORDER.flatMap((slot) => {
    const texts = phrases.filter((phrase) => phrase.slot === slot).map((phrase) => phrase.text)
    if (!texts.length) return []
    return slot === 'con' ? [`con ${texts.join(' y ')}`] : [texts.join(' y ')]
  })
  return `Porque te gustan los ${noun} ${parts.join(' ')}`
}
