import { findDef, isStyleId, normalize, type StyleId } from '@shared/tags.ts'
import { resolveNeighborhood } from '@shared/neighborhood-aliases.ts'
import { INTENT_VERBS, type IntentId } from '@shared/intents.ts'
import { canonicalOf, singularForms } from './dishes'
import { readWhen, WHEN_PHRASES } from './when'
import { BEST_WORDS, emptyInterpretation, tidy, type Interpretation, type Price } from './interpretation'

const STOPWORDS_ES = new Set(['en', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con', 'para', 'por', 'a', 'al', 'zona', 'barrio'])
const STOPWORDS_EN = new Set(['in', 'at', 'near', 'the', 'a', 'an', 'with', 'for', 'and', 'or', 'of', 'to', 'around', 'area'])

const NEAR_ME = new Map([
  ['cerca mio', 'es'], ['cerca mia', 'es'], ['cerca de mi', 'es'], ['cerca de aca', 'es'], ['near me', 'en'], ['nearby', 'en'],
] as const)
// Precio pedido: filtra (lo desconocido pasa) y un precio confirmado que coincide rankea más arriba.
const PRICE_WORDS = new Map<string, [Price[], 'es' | 'en']>([
  ...['barato', 'barata', 'baratos', 'baratas', 'economico', 'economica', 'economicos', 'economicas'].map((word) => [word, [['low'], 'es']] as const),
  ...['caro', 'cara', 'caros', 'caras'].map((word) => [word, [['high', 'very_high'], 'es']] as const),
  ...['de lujo', 'lujoso', 'lujosa', 'lujosos'].map((word) => [word, [['very_high'], 'es']] as const),
  ['cheap', [['low'], 'en']], ['inexpensive', [['low'], 'en']], ['expensive', [['high', 'very_high'], 'en']], ['luxury', [['very_high'], 'en']],
] as [string, [Price[], 'es' | 'en']][])

// Citas que traen el estilo: una tranqui o descontracturada es casual; una romántica o especial, cuidado. "cita" sola es sólo date.
// also: otra frase del catálogo que la consulta también pide, resuelta igual que si viniera sola ("cena romántica" → "cena").
const DATE_STYLES = new Map<string, { style: StyleId; also?: string; language?: 'en' }>([
  ...['primera cita', 'algo tranqui para una cita', 'cita tranqui', 'cita descontracturada', 'cita informal'].map((phrase) => [phrase, { style: 'casual' }] as const),
  ...['aniversario', 'cita especial', 'cita romantica'].map((phrase) => [phrase, { style: 'cuidado' }] as const),
  ['cena romantica', { style: 'cuidado', also: 'cena' }],
  ['anniversary', { style: 'cuidado', language: 'en' }],
])

// Verbos que piden una intención sin nombrar un tag ("comer", "tomar algo"). Se miran antes que el catálogo, así
// "tomar algo" es sólo Bares y no exige el tag drinks; una frase más larga del catálogo ("comer de noche") gana igual.
const VERBS = new Map<string, [IntentId, 'es' | 'en']>(INTENT_VERBS.map(([phrase, id, lang]) => [normalize(phrase), [id, lang]]))

// Platos genéricos sin tag propio en el catálogo: van como plato con su respaldo, sin pasar por el modelo.
// pescado, mariscos y pollo no hacen falta: son sinónimos de seafood y chicken. "sin carne" es vegetarian (frase más larga).
type GenericDish = { relatedTags: string[]; relatedCategories: string[]; language: 'es' | 'en' }
const MEAT = (language: 'es' | 'en'): GenericDish => ({ relatedTags: ['grilled_meat'], relatedCategories: ['grill'], language })
const GENERIC_DISHES = new Map<string, GenericDish>([['carne', MEAT('es')], ['carnes', MEAT('es')], ['meat', MEAT('en')]])

const MAX_PHRASE_WORDS = 5

/** Idioma de un sinónimo: en si sólo aparece entre las formas en inglés del tag. */
function phraseLanguage(id: string, phrase: string): 'es' | 'en' | null {
  const definition = findDef(id)
  if (!definition) return null
  const matches = (names: string[]) => names.some((name) => singularForms(phrase).includes(normalize(name)) || normalize(name) === phrase)
  const es = matches([definition.label.es, ...definition.synonyms.es, ...(definition.dishes?.es ?? [])])
  const en = matches([definition.label.en, ...definition.synonyms.en, ...(definition.dishes?.en ?? [])])
  return en && !es ? 'en' : es && !en ? 'es' : null
}

/** Aplica una frase del catálogo donde corresponde. Devuelve su idioma (null si es ambiguo), o undefined si no está. */
function applyTerm(target: Interpretation, phrase: string): 'es' | 'en' | null | undefined {
  const found = canonicalOf(phrase)
  if (!found) return undefined
  if (found.group === 'categories') target.must.categories.push(found.id)
  else if (found.group === 'dietary') target.must.diet[found.id === 'gluten_free' ? 'glutenFree' : (found.id as 'vegan' | 'vegetarian')] = true
  // Un plato típico de una cocina ("tacos") se busca como plato, con la cocina de respaldo: no filtra por cocina.
  else if (found.group === 'foods' || found.dish) target.dishes.push({ name: phrase, relatedTags: [found.id], relatedCategories: [] })
  else if (found.group === 'style') target.prefer.style ??= isStyleId(found.id) ? found.id : null
  else if (found.group === 'atmosphere' || found.group === 'goodFor') target.prefer.tags.push(found.id)
  else target.must.tags.push(found.id)
  return phraseLanguage(found.id, phrase)
}

// Lo que viene después de una negación suelta ("algo que no sea pizza") no se toma como pedido en el modo parcial.
const NEGATIONS = new Set(['no', 'ni', 'sin', 'excepto', 'salvo', 'menos', 'not', 'except', 'without'])

/**
 * Atajo sin LLM: si toda la consulta se cubre con barrios, tags, horario (when.ts) y palabras vacías,
 * arma la interpretación directamente. El horario lo resuelve applyWhen al final, con todo el texto. Devuelve null
 * en cuanto queda una palabra sin reconocer.
 *
 * partial: respaldo cuando el modelo no responde. Toma lo que reconoce e ignora el resto (que igual cuenta
 * para el embedding y las palabras clave); lo que sigue a una negación suelta se descarta.
 */
export function interpretWithDictionary(normalized: string, { partial = false }: { partial?: boolean } = {}): Interpretation | null {
  const words = normalized.split(' ').filter(Boolean)
  if (words.length === 0) return null
  const result = emptyInterpretation()
  const votes = { es: 0, en: 0 }
  let matched = 0
  let negated = false
  let lateWord = false
  let outWord = false

  for (let index = 0; index < words.length; ) {
    let consumed = 0
    // Lo negado se reconoce igual (para consumir la frase entera) pero no se aplica.
    const target = negated ? emptyInterpretation() : result
    for (let length = Math.min(MAX_PHRASE_WORDS, words.length - index); length >= 1 && consumed === 0; length--) {
      const phrase = words.slice(index, index + length).join(' ')
      const neighborhood = resolveNeighborhood(phrase)
      const when = WHEN_PHRASES.get(phrase)
      const nearMe = NEAR_ME.get(phrase as never)
      const price = PRICE_WORDS.get(phrase)
      const dateStyle = DATE_STYLES.get(phrase)
      const verb = VERBS.get(phrase)
      const genericDish = GENERIC_DISHES.get(phrase)
      if (neighborhood) {
        target.must.neighborhoods.push(neighborhood)
      } else if (when) {
        // "tarde" suelta sólo se entiende con bares ("tomar algo tarde"); si no, que la lea el modelo.
        if (when[0].kind === 'late') lateWord = true
        votes[when[1]]++
      } else if (nearMe) {
        target.unrecognized.push(phrase)
        target.needsLocation = true
        votes[nearMe]++
      } else if (price) {
        target.must.price.push(...price[0])
        votes[price[1]]++
      } else if (dateStyle) {
        target.prefer.tags.push('date')
        target.prefer.style ??= dateStyle.style
        if (dateStyle.also) applyTerm(target, dateStyle.also)
        votes[dateStyle.language ?? 'es']++
      } else if (verb) {
        target.intent ??= verb[0]
        votes[verb[1]]++
      } else if (genericDish) {
        target.dishes.push({ name: phrase, relatedTags: genericDish.relatedTags, relatedCategories: genericDish.relatedCategories })
        votes[genericDish.language]++
      } else {
        const language = applyTerm(target, phrase)
        if (language === undefined) continue
        if (language) votes[language]++
      }
      consumed = length
    }
    if (consumed === 0) {
      const word = words[index]
      // "mejor", "best", "top": no es un filtro; sólo amplía el multiplicador de calidad.
      if (BEST_WORDS.has(word)) {
        result.wantsBest = true
        const language = BEST_WORDS.get(word)
        if (language) votes[language] += 0.5
      } else if (word === 'salir') {
        // "salir" sólo se entiende con un horario de noche ("salir tarde", "salir de noche"): lo decide applyWhen.
        outWord = true
        votes.es += 0.5
      } else if (STOPWORDS_ES.has(word)) votes.es += 0.5
      else if (STOPWORDS_EN.has(word)) votes.en += 0.5
      else if (!partial) return null
      else if (NEGATIONS.has(word)) negated = true
      consumed = 1
    } else {
      matched++
      negated = false
    }
    index += consumed
  }

  if (matched === 0 && !partial) return null
  result.language = votes.en > votes.es ? 'en' : 'es'
  const timed = readWhen(tidy(result), normalized)
  // "tarde" o "salir" que el horario no usó (sin bares ni noche) quedan sin reconocer: que la lea el modelo.
  if (!partial && ((lateWord && !timed.late) || (outWord && !timed.out))) return null
  return tidy(timed.interpretation)
}
