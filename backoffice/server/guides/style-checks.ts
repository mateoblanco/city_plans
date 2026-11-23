import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'

/**
 * Chequeos de estilo de los textos generados, además del prompt (que es lo que más pesa). Son reglas de palabras, no un
 * juez: atrapan lo más común (muletillas, el tema repetido, la carta enumerada, el precio suelto, arranques iguales) y
 * el editor muestra el motivo para regenerar. Todos devuelven la lista de problemas; vacía = el texto pasa.
 */

export const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const STOPWORDS = new Set(
  'a al ante con de del desde el en entre es esta este hay la las lo los para por que se sin su sus un una uno unos unas y o u ni te tu mas muy ya'.split(' '),
)

const contentWords = (text: string) => plain(text).split(' ').filter((word) => word && !STOPWORDS.has(word))

/** La lista de muletillas prohibidas de la guía de estilo: los ítems de la sección "Muletillas prohibidas", sin comillas. */
export function forbiddenPhrases(style: string): string[] {
  const section = style.split(/^## /m).find((part) => /^muletillas prohibidas/i.test(part))
  if (!section) return []
  return section
    .split('\n')
    .filter((line) => /^\s*-\s+/.test(line))
    .flatMap((line) => line.replace(/^\s*-\s+/, '').split(/[,;]/))
    .map((item) => plain(item.replace(/["“”«»]/g, '')))
    .filter(Boolean)
}

const containsPhrase = (text: string, phrase: string) => ` ${plain(text)} `.includes(` ${phrase} `)

/** Muletillas de la guía de estilo que aparecen en el texto. */
export function phraseIssues(text: string, phrases: readonly string[]): string[] {
  const found = phrases.filter((phrase) => containsPhrase(text, phrase))
  return found.length > 0 ? [`muletillas prohibidas (${found.map((phrase) => `"${phrase}"`).join(', ')})`] : []
}

/**
 * El tema de la guía repetido en el texto de un lugar: dos palabras seguidas con contenido del gancho del título (lo de
 * antes de los dos puntos) o de la idea ("primera cita" de "Primera cita sin ceremonia: …").
 */
export function themeIssues(text: string, themes: readonly string[]): string[] {
  const value = ` ${contentWords(text).join(' ')} `
  for (const theme of themes) {
    const words = contentWords(theme.split(':')[0])
    for (let index = 0; index < words.length - 1; index++) {
      if (value.includes(` ${words[index]} ${words[index + 1]} `)) return [`el tema de la guía ("${words[index]} ${words[index + 1]}", ya está en el título)`]
    }
  }
  return []
}

/** Las primeras 3 palabras, para comparar arranques. */
const opening = (text: string) => plain(text).split(' ').slice(0, 3).join(' ')

/** El mismo arranque que otro texto de la guía. */
export function openingIssues(text: string, others: readonly string[]): string[] {
  const start = opening(text)
  if (start.split(' ').length < 3) return []
  return others.some((other) => opening(other) === start) ? [`el mismo arranque que otro lugar ("${start}…")`] : []
}

export const MAX_DISHES = 2

const singular = (phrase: string) => phrase.split(' ').map((word) => word.replace(/(es|s)$/, '')).join(' ')

/**
 * Más de MAX_DISHES platos de los datos del lugar (`platos`, no las categorías como "Tapas y platitos" o "Postres")
 * nombrados en el texto: está enumerando la carta. El singular y el plural son el mismo plato ("chivito", "chivitos"),
 * y uno que está dentro de otro nombrado cuenta una vez ("pollo" en "shawarma de pollo").
 */
export function dishIssues(text: string, dishes: readonly string[]): string[] {
  const value = ` ${singular(plain(text))} `
  // Forma comparable → el nombre como está en los datos (el primero), para el mensaje.
  const original = new Map<string, string>()
  for (const dish of dishes) {
    const key = singular(plain(dish))
    if (key && !original.has(key)) original.set(key, dish)
  }
  const named = [...original.keys()].filter((dish) => value.includes(` ${dish} `))
  const distinct = named.filter((dish) => !named.some((other) => other !== dish && ` ${other} `.includes(` ${dish} `)))
  return distinct.length > MAX_DISHES ? [`más de ${MAX_DISHES} platos (${distinct.map((dish) => original.get(dish)).join(', ')})`] : []
}

const PRICE_ONLY = new Set(['caro', 'cara', 'economico', 'economica', 'precio', 'medio', 'es', 'de', 'un', 'una', 'el', 'la', 'algo', 'poco', 'bastante'])

/** El precio como frase suelta ("Es caro.", "Precio medio."): tiene que ir integrado en una frase. */
export function standalonePriceIssues(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).map(plain).filter(Boolean)
  const loose = sentences.some((sentence) => sentence.split(' ').every((word) => PRICE_ONLY.has(word)) && /\b(caro|cara|economic[oa]|precio medio)\b/.test(sentence))
  return loose ? ['el precio como frase suelta (va integrado en otra frase)'] : []
}

let neighborhoodNames: string[] | null = null

/** Barrios nombrados en el texto (por su nombre visible). */
export function namedNeighborhoods(text: string): string[] {
  neighborhoodNames ??= Object.keys(NEIGHBORHOOD_NAMES).map((id) => plain(neighborhoodDisplayName(id) ?? id))
  return [...new Set(neighborhoodNames.filter((name) => containsPhrase(text, name)))]
}

/** La intro: sin nombrar lugares de la guía ni enumerar barrios (uno, el de la guía, se tolera). */
export function introIssues(text: string, placeNames: readonly string[]): string[] {
  const issues: string[] = []
  const places = placeNames.filter((name) => plain(name).length >= 3 && containsPhrase(text, plain(name)))
  if (places.length > 0) issues.push(`nombres de lugares (${places.join(', ')})`)
  const neighborhoods = namedNeighborhoods(text)
  if (neighborhoods.length >= 2) issues.push(`una lista de barrios (${neighborhoods.join(', ')})`)
  return issues
}
