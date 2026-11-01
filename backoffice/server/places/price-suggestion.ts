import { menuPricesInText, type Source } from '../providers/place-extraction-service.ts'
import { PRICE_CUTS, PRICE_KIND_LABELS, priceKindOf, tierFor, type PriceKind, type PriceTier } from '../providers/price-tiers.ts'

// Precio sugerido para `yarn prices:suggest`: no cambia places.price, se guarda en price_suggestions y la tabla de
// Lugares lo ofrece para aceptar. Señales, de la que más pesa a la que menos:
// 1. La carta: una fuente con al menos MENU_MIN_PRICES precios sueltos; el percentil MENU_PERCENTILE, con los cortes del
//    tipo (price-tiers). No la mediana: la carta trae bebidas, entradas y agregados, que la tiran para abajo.
// 2. Frases en las fuentes ("precios accesibles", "alta cocina"…): valen 2.
// 3. Tags, categorías e íconos (menú del día, de barrio, elegante…): valen 1.
// Sin carta gana el lado con al menos 2 puntos y más que el otro; empate, sin sugerencia.

export type PriceSuggestionSignal = 'menu' | 'phrase' | 'tags'

export type PriceSuggestion = {
  price: PriceTier
  signal: PriceSuggestionSignal
  reason: string
  snippet: string | null
  sourceUrl: string | null
}

export type PriceSuggestionPlace = {
  iconCategory: string | null
  categories: readonly string[]
  tags: readonly string[]
  style: string | null
}

export const MENU_MIN_PRICES = 5
export const MENU_PERCENTILE = 0.65
// Un precio de carta va de un tercio del corte bajo (deja afuera cafés, aguas y agregados) a MENU_MAX.
const MENU_MAX = 6000
// Un precio de producto o de pack, no de un plato: termos, cafeteras, ropa, kilos, encargues, cajas para cumpleaños o
// para varios.
const PRODUCT = /cafetera|tumbler|rambler|\btermo|\byeti\b|remera|camisa|\bbuzo|gorra|\bmerch|\bkg\b|encargu?e|para \d+ personas|cumplea[nñ]os|masitas|\bbolsa\b|\bpack\b/i
// Una tienda online no es una carta (bolsas de café, cafeteras, tortas por encargo, ropa): como en la extracción, se ignora.
const STORE = /tienda online|carrito|precio habitual|comprar\s*[›>]|\bshop\b|altitud|\b\d+\s?(?:g|gr|grs|kg)\b[^$\n]{0,40}\$/i

type Side = 'low' | 'high'

const PHRASES: Record<Side, string[]> = {
  low: ['precios accesibles', 'precio accesible', 'economico', 'economica', 'barato', 'barata', 'precio justo', 'precios justos'],
  high: ['menu degustacion', 'menu de degustacion', 'alta cocina', 'exclusivo', 'exclusiva'],
}
// Palabras sueltas que también se usan para otra cosa ("bloque económico", "contenido exclusivo", "beneficio exclusivo
// de Salir a Comer"): cuentan sólo si la oración habla de comer o de precios y, exclusivo, si califica al lugar.
const LOOSE_PHRASES = new Set(['economico', 'economica', 'barato', 'barata', 'exclusivo', 'exclusiva'])
const PRICE_TALK = /(?<![a-z])(?:precios?|menu|comer|comida|opcion|opciones|platos?|carta|bolsillo|almuerzos?|almorzar|cenas?|cenar|comedor|restaurantes?|lugar|propuesta|ambiente|experiencia)(?![a-z])/
const EXCLUSIVE_NOUN = /(?:contenido|beneficio|descuento|forma|manera|uso|acceso|venta|distribuidor|importador|evento|lanzamiento|promo|promocion|en)\s+$/
const EXCLUSIVE_FOR = /^\s+(?:de|del|para|a|al|en|descuento|beneficio|contenido)(?![a-z])/
// "escuela de alta cocina", "curso de alta cocina": habla de la formación, no del lugar.
const SCHOOL = /(?:escuela|curso|estudios?|formacion|instituto)\s+(?:de\s+)?$/
// Justo antes de la frase: "no es barato", "nada económico", "poco accesible".
const NEGATION = /(?:^|[^a-z])(?:no|nada|ni|poco)\s+(?:(?:es|son|tan|muy|tiene|tienen|precios?)\s+){0,2}$/

const TAG_SIGNALS: Record<Side, { tags: string[]; categories: string[]; icons: string[]; styles: string[] }> = {
  low: { tags: ['menu_of_the_day', 'quick', 'neighborhood_spot'], categories: ['chiviteria', 'bodegon'], icons: ['hot_dog', 'sandwich', 'fries'], styles: [] },
  high: { tags: ['elegant'], categories: ['wine_bar'], icons: [], styles: ['cuidado'] },
}

/** Minúsculas y sin acentos, carácter por carácter: las posiciones siguen valiendo en el texto original. */
const fold = (text: string) => [...text].map((char) => (char.length === 1 ? char.normalize('NFD')[0].toLowerCase()[0] : char)).join('')
const clean = (text: string) => text.replace(/\s+/g, ' ').trim()

/** La oración (o línea) que contiene [start, end), recortada a ~maxLength alrededor. */
function sentenceAround(text: string, start: number, end: number, maxLength = 160) {
  const before = text.slice(0, start)
  const sentenceStart = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n')) + 1
  const after = text.slice(end)
  const ends = [after.indexOf('.'), after.indexOf('!'), after.indexOf('?'), after.indexOf('\n')].filter((index) => index >= 0)
  const sentenceEnd = end + (ends.length ? Math.min(...ends) : after.length)
  const from = Math.max(sentenceStart, start - maxLength / 2)
  const to = Math.min(sentenceEnd, end + maxLength / 2)
  return `${from > sentenceStart ? '…' : ''}${clean(text.slice(from, to))}${to < sentenceEnd ? '…' : ''}`
}

/** Percentil con interpolación lineal entre los dos valores vecinos. */
export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * p
  const below = Math.floor(position)
  return sorted[below] + (sorted[Math.min(below + 1, sorted.length - 1)] - sorted[below]) * (position - below)
}

const peso = (value: number) => `$${Math.round(value).toLocaleString('es-UY')}`

function menuSuggestion(kind: PriceKind, sources: readonly Source[]): PriceSuggestion | null {
  const floor = PRICE_CUTS[kind].low / 3
  const menus = sources
    .filter((source) => !STORE.test(source.text))
    .map((source) => ({
      source,
      prices: menuPricesInText(source.text).filter((price) => price.value >= floor && price.value <= MENU_MAX && !PRODUCT.test(source.text.slice(Math.max(0, price.start - 60), price.start))),
    }))
    .filter((menu) => menu.prices.length >= MENU_MIN_PRICES)
  const official = menus.filter((menu) => menu.source.trust === 'official')
  const chosen = official.length ? official : menus
  if (!chosen.length) return null
  const all = chosen.flatMap((menu) => menu.prices.map((price) => ({ ...price, source: menu.source })))
  const value = percentile(all.map((price) => price.value), MENU_PERCENTILE)
  const price = tierFor(kind, value)
  const cuts = PRICE_CUTS[kind]
  const closest = [...all].sort((a, b) => Math.abs(a.value - value) - Math.abs(b.value - value)).slice(0, 3)
  const quotes = closest.map((item) => `"${clean(item.source.text.slice(Math.max(0, item.start - 40), item.end)).replace(/^\S*\s/, '')}"`)
  return {
    price,
    signal: 'menu',
    reason: `Carta: percentil 65 ${peso(value)} de ${all.length} precios (${PRICE_KIND_LABELS[kind]}: < ${peso(cuts.low)} accesible, > ${peso(cuts.high)} caro)`,
    snippet: quotes.join(' · '),
    sourceUrl: closest[0].source.url || null,
  }
}

type PhraseHit = { side: Side; phrase: string; snippet: string; url: string }

function phraseHits(sources: readonly Source[]): PhraseHit[] {
  const hits = new Map<string, PhraseHit>()
  for (const source of sources) {
    const folded = fold(source.text)
    for (const side of ['low', 'high'] as const) {
      for (const phrase of PHRASES[side]) {
        if (hits.has(phrase)) continue
        for (const match of folded.matchAll(new RegExp(`(?<![a-z])${phrase}(?![a-z])`, 'g'))) {
          const start = match.index ?? 0
          const end = start + phrase.length
          if (NEGATION.test(folded.slice(Math.max(0, start - 25), start))) continue
          if (LOOSE_PHRASES.has(phrase) && !PRICE_TALK.test(fold(sentenceAround(source.text, start, end)))) continue
          if (phrase === 'alta cocina' && SCHOOL.test(folded.slice(Math.max(0, start - 25), start))) continue
          if (phrase.startsWith('exclusiv') && (EXCLUSIVE_NOUN.test(folded.slice(Math.max(0, start - 25), start)) || EXCLUSIVE_FOR.test(folded.slice(end, end + 14)))) continue
          hits.set(phrase, { side, phrase: clean(source.text.slice(start, start + phrase.length)), snippet: sentenceAround(source.text, start, start + phrase.length), url: source.url })
          break
        }
      }
    }
  }
  return [...hits.values()]
}

const TAG_LABELS: Record<string, string> = {
  menu_of_the_day: 'menú del día', quick: 'algo rápido', neighborhood_spot: 'de barrio', chiviteria: 'chivitería', bodegon: 'bodegón',
  hot_dog: 'ícono panchos', sandwich: 'ícono sándwiches', fries: 'ícono comida rápida', elegant: 'elegante', wine_bar: 'vinoteca', cuidado: 'estilo cuidado',
}

function tagHits(place: PriceSuggestionPlace, side: Side): string[] {
  const signals = TAG_SIGNALS[side]
  return [
    ...signals.tags.filter((tag) => place.tags.includes(tag)),
    ...signals.categories.filter((category) => place.categories.includes(category)),
    ...signals.icons.filter((icon) => place.iconCategory === icon),
    ...signals.styles.filter((style) => place.style === style),
  ].map((id) => TAG_LABELS[id] ?? id)
}

/** Sugerencia para un lugar con las fuentes de su snapshot (null sin snapshot: sólo tags). Null si no hay señal. */
export function suggestPrice(place: PriceSuggestionPlace, sources: readonly Source[] | null): PriceSuggestion | null {
  const kind = priceKindOf(place.iconCategory, place.categories)
  const menu = sources ? menuSuggestion(kind, sources) : null
  if (menu) return menu

  const phrases = sources ? phraseHits(sources) : []
  const score = (side: Side) => phrases.filter((hit) => hit.side === side).length * 2 + tagHits(place, side).length
  const [low, high] = [score('low'), score('high')]
  const side: Side | null = low >= 2 && low > high ? 'low' : high >= 2 && high > low ? 'high' : null
  if (!side) return null
  const sidePhrases = phrases.filter((hit) => hit.side === side)
  const tags = tagHits(place, side)
  const parts = [
    ...(sidePhrases.length ? [`frase${sidePhrases.length > 1 ? 's' : ''} ${sidePhrases.map((hit) => `"${hit.phrase}"`).join(', ')}`] : []),
    ...(tags.length ? [`tags ${tags.join(', ')}`] : []),
  ]
  const against = side === 'low' ? high : low
  return {
    price: side,
    signal: sidePhrases.length ? 'phrase' : 'tags',
    reason: `${sidePhrases.length ? 'Frase en las fuentes' : 'Tags'}: ${parts.join(' + ')}${against ? ` (en contra: ${against} pt)` : ''}`,
    snippet: sidePhrases[0]?.snippet ?? null,
    sourceUrl: sidePhrases[0]?.url || null,
  }
}
