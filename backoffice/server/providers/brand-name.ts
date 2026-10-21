import { NEIGHBORHOOD_NAMES } from '../../src/data/neighborhood-names.ts'
import { toCanonical } from '../../src/data/tags.ts'

const canonical = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const words = (value: string) => canonical(value).split(/[^a-z0-9]+/).filter(Boolean)

// Sufijos de sucursal: barrios, nombres cortos de barrios compuestos, shoppings y la ciudad.
const PLACE_SUFFIXES = [
  ...Object.values(NEIGHBORHOOD_NAMES),
  'Prado', 'Parque Batlle', 'Colón', 'Maroñas', 'Peñarol', 'Capurro', 'Bella Vista',
  'Nuevocentro', 'Portones', 'Costa Urbana', 'Montevideo',
].map(words).sort((left, right) => right.length - left.length)
const BRANCH_WORDS = new Set(['sucursal', 'shopping', 'centro', 'local', 'express'])
const TRAILING_STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'en', 'al', 'y'])

/** Cuántas palabras del final consume cada recorte sucesivo de sufijos de sucursal. */
function tailCuts(tokens: string[]): number[] {
  const cuts: number[] = []
  let end = tokens.length
  while (end > 0) {
    const tail = tokens.slice(0, end).map((token) => canonical(token).replace(/[^a-z0-9]/g, ''))
    const suffix = PLACE_SUFFIXES.find((phrase) => phrase.length <= tail.length && phrase.every((word, index) => tail[tail.length - phrase.length + index] === word))
    if (suffix) end -= suffix.length
    else if (BRANCH_WORDS.has(tail[tail.length - 1])) end -= 1
    // "Local 12", "Sucursal 3": el número sólo sale junto con la palabra de sucursal.
    else if (/^\d+$/.test(tail[tail.length - 1]) && BRANCH_WORDS.has(tail[tail.length - 2] ?? '')) end -= 2
    else break
    cuts.push(end)
  }
  return cuts
}

/** Un segmento entre paréntesis o después de " - " es sucursal si se consume entero con los sufijos. */
function isBranchSegment(segment: string) {
  const tokens = segment.trim().split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
  return tokens.length > 0 && tailCuts(tokens).at(-1) === 0
}

/** La marca no puede quedar en una sola palabra genérica de tags.ts ni terminar en artículo o preposición. */
function validBrand(candidate: string) {
  const tokens = words(candidate)
  if (tokens.length === 0 || TRAILING_STOPWORDS.has(tokens.at(-1)!)) return false
  return !(tokens.length === 1 && toCanonical(candidate))
}

// Separadores de un agregado (sucursal, ubicación o descripción): con espacios alrededor, o "(" o
// una comilla (Hakuna Matata "Pizza Cubana"). Un guion sin espacios es parte del nombre ("Coca-Cola", "Pan-Ka").
const DESCRIPTOR_SEPARATOR = /\s+[|\-–—·]\s+|\s*[("“”«]/

/**
 * Marca a partir del nombre de Google, y si el recorte sacó una sucursal. Primero corta en el primer
 * separador (" | ", " - ", " – ", " — ", " · ", "(" o una comilla " “ ” «): lo que sigue es sucursal, ubicación o
 * descripción. Después le saca los sufijos de sucursal del final (barrio, "sucursal", "shopping",
 * "centro"…). Un corte que deja menos de 3 caracteres o algo genérico no se hace.
 * `branch` es true sólo si lo recortado es una sucursal: un agregado descriptivo ("| Museo
 * Nacional…", "- Hot Dogs") no hace del lugar una sucursal de cadena.
 */
export function googleNameParts(name: string): { brand: string; branch: boolean } {
  let brand = name.trim()
  let branch = false
  const separator = DESCRIPTOR_SEPARATOR.exec(brand)
  if (separator) {
    const before = brand.slice(0, separator.index).trim()
    const after = brand.slice(separator.index + separator[0].length).replace(/[)"“”»]\s*$/, '').trim()
    if (before.replace(/\s+/g, '').length >= 3 && validBrand(before)) {
      brand = before
      branch = isBranchSegment(after)
    }
  }

  const tokens = brand.split(/\s+/)
  const sucursal = tokens.findIndex((token, index) => index > 0 && canonical(token).replace(/[^a-z]/g, '') === 'sucursal')
  const cuts = [...(sucursal > 0 ? [sucursal] : []), ...tailCuts(tokens).reverse()]
  for (const cut of cuts) {
    const candidate = tokens.slice(0, cut).join(' ').replace(/[\s,\-|–—·]+$/, '')
    if (validBrand(candidate)) return { brand: candidate, branch: true }
  }
  return { brand, branch }
}

/** La marca sin sucursal ni agregados del nombre de Google (ver googleNameParts). */
export function brandFromGoogleName(name: string): string {
  return googleNameParts(name).brand
}

// Tipos de Google que no ayudan a desambiguar una búsqueda.
const GENERIC_PLACE_TYPES = new Set(['establecimiento', 'punto de interes', 'lugar'])

/**
 * Término de búsqueda para Exa e Instagram: la marca más el tipo de lugar de Google
 * (primaryTypeDisplayName), para no mezclar homónimos ("Musse restaurante", no el artista).
 * Sólo arma la consulta: el tipo no se guarda. No se agrega si la marca ya lo dice.
 */
export function brandSearchTerm(brand: string, placeType: string | null | undefined): string {
  const type = placeType?.trim()
  if (!type || GENERIC_PLACE_TYPES.has(words(type).join(' '))) return brand
  const brandWords = new Set(words(brand))
  if (words(type).every((word) => brandWords.has(word))) return brand
  return `${brand} ${type.toLocaleLowerCase('es')}`
}

// Palabras de rubro que no distinguen una marca ("Plaza Café", "The Lab Coffee Roasters").
const RUBRO_WORDS = new Set([
  'bar', 'cafe', 'resto', 'restaurante', 'restaurant', 'restobar', 'club', 'casa', 'coffee', 'pub', 'cantina',
  'comedor', 'bodegon', 'pizzeria', 'parrilla', 'parrillada', 'heladeria', 'cerveceria', 'rotiseria', 'pastas',
  'burger', 'burgers', 'cookies', 'roasters', 'tapas', 'irish', 'scottish', 'espacio', 'creativo', 'social',
])
const BRAND_STOPWORDS = new Set([...TRAILING_STOPWORDS, 'the', 'and', 'a'])
const SHORT_BRAND_MAX_LETTERS = 5

/**
 * Marca corta o genérica: sin artículos, palabras de rubro ni tags de tags.ts, no queda nada (Vereda, Negroni)
 * o queda una sola palabra de hasta 5 letras (MOB, La Otra, Pulpo Bar de Pastas). Con esas, Exa mezcla otros
 * lugares si no sabe el barrio; con un nombre distintivo (Matute, Pantagruel) el barrio sólo trae listas del barrio.
 */
export function isShortOrGenericBrand(brand: string): boolean {
  const own = words(brand).filter((word) => !BRAND_STOPWORDS.has(word) && !RUBRO_WORDS.has(word) && !toCanonical(word))
  return own.length === 0 || own.length === 1 && own[0].length <= SHORT_BRAND_MAX_LETTERS
}

/**
 * Término de la búsqueda principal de Exa: el de brandSearchTerm, más el barrio si la marca es corta o genérica.
 * Nunca en una sucursal de cadena según el nombre de Google: el barrio no separa dos sucursales del mismo barrio
 * (Costa Azul) y sólo trae las otras.
 */
export function placeSearchTerm(googleName: string, placeType: string | null | undefined, neighborhood: string | null): string {
  const { brand, branch } = googleNameParts(googleName)
  const term = brandSearchTerm(brand, placeType)
  return neighborhood && !branch && isShortOrGenericBrand(brand) ? `${term} ${neighborhood}` : term
}
