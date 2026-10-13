import { findDef, normalize } from '@shared/tags.ts'
import { resolveNeighborhood } from '@shared/neighborhood-aliases.ts'
import { canonicalOf, singularForms } from './dishes'
import { emptyInterpretation, tidy, type Interpretation } from './interpretation'

const STOPWORDS_ES = new Set(['en', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con', 'para', 'por', 'a', 'al', 'zona', 'barrio'])
const STOPWORDS_EN = new Set(['in', 'at', 'near', 'the', 'a', 'an', 'with', 'for', 'and', 'or', 'of', 'to', 'around', 'area'])

const OPEN_NOW = new Map([
  ['abierto ahora', 'es'], ['abiertos ahora', 'es'], ['abierto', 'es'], ['abiertos', 'es'], ['ahora', 'es'],
  ['open now', 'en'], ['open', 'en'],
] as const)
const NEAR_ME = new Map([
  ['cerca mio', 'es'], ['cerca mia', 'es'], ['cerca de mi', 'es'], ['cerca de aca', 'es'], ['near me', 'en'], ['nearby', 'en'],
] as const)
const DAYS = new Map<string, [number, 'es' | 'en']>([
  ['domingo', [0, 'es']], ['lunes', [1, 'es']], ['martes', [2, 'es']], ['miercoles', [3, 'es']], ['jueves', [4, 'es']], ['viernes', [5, 'es']], ['sabado', [6, 'es']],
  ['sunday', [0, 'en']], ['monday', [1, 'en']], ['tuesday', [2, 'en']], ['wednesday', [3, 'en']], ['thursday', [4, 'en']], ['friday', [5, 'en']], ['saturday', [6, 'en']],
])

const MAX_PHRASE_WORDS = 5

/** Idioma de un sinónimo: en si sólo aparece entre las formas en inglés del tag. */
function phraseLanguage(id: string, phrase: string): 'es' | 'en' | null {
  const definition = findDef(id)
  if (!definition) return null
  const matches = (names: string[]) => names.some((name) => singularForms(phrase).includes(normalize(name)) || normalize(name) === phrase)
  const es = matches([definition.label.es, ...definition.synonyms.es])
  const en = matches([definition.label.en, ...definition.synonyms.en])
  return en && !es ? 'en' : es && !en ? 'es' : null
}

/**
 * Atajo sin LLM: si toda la consulta se cubre con barrios, tags, días, "abierto ahora" y palabras vacías,
 * arma la interpretación directamente. Devuelve null en cuanto queda una palabra sin reconocer.
 */
export function interpretWithDictionary(normalized: string): Interpretation | null {
  const words = normalized.split(' ').filter(Boolean)
  if (words.length === 0) return null
  const result = emptyInterpretation()
  const votes = { es: 0, en: 0 }
  let matched = 0

  for (let index = 0; index < words.length; ) {
    let consumed = 0
    for (let length = Math.min(MAX_PHRASE_WORDS, words.length - index); length >= 1 && consumed === 0; length--) {
      const phrase = words.slice(index, index + length).join(' ')
      const neighborhood = resolveNeighborhood(phrase)
      const openNow = OPEN_NOW.get(phrase as never)
      const nearMe = NEAR_ME.get(phrase as never)
      const day = DAYS.get(phrase)
      if (neighborhood) {
        result.must.neighborhoods.push(neighborhood)
      } else if (openNow) {
        result.must.openAt = 'now'
        votes[openNow]++
      } else if (nearMe) {
        result.unrecognized.push(phrase)
        result.needsLocation = true
        votes[nearMe]++
      } else if (day) {
        result.must.openAt = { day: day[0], time: null }
        votes[day[1]]++
      } else {
        const found = canonicalOf(phrase)
        if (!found) continue
        const language = phraseLanguage(found.id, phrase)
        if (language) votes[language]++
        if (found.group === 'categories') result.must.categories.push(found.id)
        else if (found.group === 'dietary') result.must.diet[found.id === 'gluten_free' ? 'glutenFree' : (found.id as 'vegan' | 'vegetarian')] = true
        else if (found.group === 'foods') result.dishes.push({ name: phrase, relatedTags: [found.id], relatedCategories: [] })
        else if (found.group === 'atmosphere' || found.group === 'goodFor') result.prefer.tags.push(found.id)
        else result.must.tags.push(found.id)
      }
      consumed = length
    }
    if (consumed === 0) {
      const word = words[index]
      if (STOPWORDS_ES.has(word)) votes.es += 0.5
      else if (STOPWORDS_EN.has(word)) votes.en += 0.5
      else return null
      consumed = 1
    } else matched++
    index += consumed
  }

  if (matched === 0) return null
  result.language = votes.en > votes.es ? 'en' : 'es'
  return tidy(result)
}
