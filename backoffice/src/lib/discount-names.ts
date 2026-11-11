import { resolveNeighborhood } from '../../../shared/neighborhood-aliases.ts'

// Nombres y barrios de los lugares de los proveedores de descuentos. Puro: lo usan el cruce del servidor
// (server/discounts/match.ts) y la vista "No están en la base" de la pantalla, así comparan igual.

/** Minúscula, sin tildes, espacios simples. */
export const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()

/** Barrio de Montevideo (id del INE) de un texto corto ("Pocitos", "Punta Carretas"); null si no es uno. */
export function montevideoNeighborhood(text: string | null): string | null {
  if (!text) return null
  return resolveNeighborhood(text.trim())
}

// Rubros, artículos y sufijos de ubicación que no distinguen un lugar.
const GENERIC = new Set([
  'restaurante', 'restaurant', 'resto', 'bar', 'cafe', 'cafeteria', 'coffee', 'parrilla', 'parrillada', 'pizzeria', 'heladeria', 'helado', 'helados',
  'cerveceria', 'bistro', 'bodegon', 'rotiseria', 'panaderia', 'confiteria', 'pub', 'grill', 'kitchen', 'cocina', 'casa',
  'el', 'la', 'los', 'las', 'de', 'del', 'the', 'y', 'and', 'by', 'uy', 'mvd', 'montevideo', 'uruguay', 'sucursal', 'local',
])

// Además de las genéricas, palabras de rubro o comida que dos lugares vecinos distintos comparten seguido ("Sumi Sushi" y
// "Kyoto Sushi"): no alcanzan para decir que son el mismo lugar aunque estén pegados.
const NOT_DISTINCTIVE = new Set([
  ...GENERIC, 'rest', 'restobar', 'food', 'foods', 'gourmet', 'deli', 'delivery', 'sushi', 'pizza', 'pizzas', 'burger', 'burgers',
  'hamburgueseria', 'house', 'club', 'store', 'shop', 'market', 'mercado', 'japanese', 'japones', 'sandwich', 'sandwicheria',
  'chivitos', 'empanadas', 'pasta', 'pastas', 'tea', 'te', 'wine', 'vinos', 'beer', 'brewery', 'pasteleria', 'dulceria', 'bakery',
  'patio', 'espacio', 'drinks', 'tragos', 'boliche', 'almacen', 'taberna', 'cantina', 'bodega', 'fonda', 'gastro', 'lounge',
  'san', 'santa', 'nuevo', 'nueva', 'gran', 'mi', 'tu', 'su', 'don', 'dona', 'a', 'al', 'en', 'con',
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'septiembre', 'octubre', 'noviembre', 'diciembre',
])

/** Palabras que distinguen un nombre: sin genéricas ni de rubro, sin números (suelen ser la calle) y de 3 letras o más. */
export const distinctiveWords = (name: string) => [...new Set(tokensOf(name).filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !NOT_DISTINCTIVE.has(token)))]

/** Las palabras distintivas que comparten dos nombres (["sumi"] para "SUMI JAPANESE FOOD" y "Sumi Sushi"). */
export function sharedDistinctiveWords(a: string, b: string): string[] {
  const right = new Set(distinctiveWords(b))
  return distinctiveWords(a).filter((word) => right.has(word))
}

export const tokensOf = (name: string) => fold(name).replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)

/** Nombre para comparar: sin tildes, sin puntuación y sin palabras genéricas (si queda algo). */
export function normalizeName(name: string): string {
  const tokens = tokensOf(name)
  const specific = tokens.filter((token) => !GENERIC.has(token))
  return (specific.length ? specific : tokens).join(' ')
}

function bigrams(value: string): string[] {
  const compact = value.replace(/ /g, '')
  const grams: string[] = []
  for (let index = 0; index < compact.length - 1; index++) grams.push(compact.slice(index, index + 2))
  return grams
}

/** Dice sobre bigramas del nombre normalizado (0 a 1). */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeName(a)
  const right = normalizeName(b)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.replace(/ /g, '') === right.replace(/ /g, '')) return 0.98
  const x = bigrams(left)
  const y = bigrams(right)
  if (x.length === 0 || y.length === 0) return 0
  const counts = new Map<string, number>()
  for (const gram of x) counts.set(gram, (counts.get(gram) ?? 0) + 1)
  let common = 0
  for (const gram of y) {
    const count = counts.get(gram) ?? 0
    if (count > 0) {
      common += 1
      counts.set(gram, count - 1)
    }
  }
  const dice = (2 * common) / (x.length + y.length)
  // Uno contiene al otro como palabras ("Es Mercat" en "El Otro Es Mercat" no: eso lo baja el resto del nombre).
  const wordsA = left.split(' ')
  const wordsB = right.split(' ')
  const contained = wordsA.every((word) => wordsB.includes(word)) || wordsB.every((word) => wordsA.includes(word))
  return contained ? Math.max(dice, 0.7) : dice
}
