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

/**
 * Marca a partir del nombre de Google: le saca los sufijos de sucursal del final (barrio,
 * "sucursal", "shopping", "centro"…). Si el recorte deja algo genérico, devuelve el nombre entero.
 */
export function brandFromGoogleName(name: string): string {
  let brand = name.trim()
  const parenthesis = /^(.+?)\s*\(([^()]*)\)$/.exec(brand)
  if (parenthesis && isBranchSegment(parenthesis[2]) && validBrand(parenthesis[1])) brand = parenthesis[1].trim()
  const separated = /^(.+?)\s+[-|–—]\s+(.+)$/.exec(brand)
  if (separated && isBranchSegment(separated[2]) && validBrand(separated[1])) brand = separated[1].trim()

  const tokens = brand.split(/\s+/)
  const sucursal = tokens.findIndex((token, index) => index > 0 && canonical(token).replace(/[^a-z]/g, '') === 'sucursal')
  const cuts = [...(sucursal > 0 ? [sucursal] : []), ...tailCuts(tokens).reverse()]
  for (const cut of cuts) {
    const candidate = tokens.slice(0, cut).join(' ').replace(/[\s,\-|–—]+$/, '')
    if (validBrand(candidate)) return candidate
  }
  return brand
}
