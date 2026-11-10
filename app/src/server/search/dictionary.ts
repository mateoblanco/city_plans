import { CUISINES, findDef, isStyleId, normalize, OCCASION_TAGS, type StyleId } from '@shared/tags.ts'
import { resolveNeighborhood } from '@shared/neighborhood-aliases.ts'
import { INTENT_VERBS, type IntentId } from '@shared/intents.ts'
import { canonicalOf, MEAT_TAG, singularForms } from './dishes'
import { readWhen, WHEN_PHRASES } from './when'
import { BEST_WORDS, emptyInterpretation, tidy, type Interpretation, type Price } from './interpretation'
import { normalizeQuery } from './normalize'

const STOPWORDS_ES = new Set(['en', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'y', 'o', 'con', 'para', 'por', 'a', 'al', 'zona', 'barrio'])
const STOPWORDS_EN = new Set(['in', 'at', 'near', 'the', 'a', 'an', 'with', 'for', 'and', 'or', 'of', 'to', 'around', 'area'])

const NEAR_ME = new Map([
  ['cerca mio', 'es'], ['cerca mia', 'es'], ['cerca de mi', 'es'], ['cerca de aca', 'es'], ['near me', 'en'], ['nearby', 'en'],
] as const)
// Precio pedido: filtra (sólo los de ese precio confirmado) y un precio confirmado que coincide rankea más arriba. Tres niveles,
// relativos al tipo de lugar: "especial" y "de lujo" son lo mismo que "caro". "cita especial" va antes por DATE_STYLES.
const PRICE_WORDS = new Map<string, [Price[], 'es' | 'en']>([
  ...['barato', 'barata', 'baratos', 'baratas', 'economico', 'economica', 'economicos', 'economicas'].map((word) => [word, [['low'], 'es']] as const),
  ...['caro', 'cara', 'caros', 'caras', 'especial', 'especiales', 'de lujo', 'lujoso', 'lujosa', 'lujosos', 'lujosas'].map((word) => [word, [['high'], 'es']] as const),
  ['cheap', [['low'], 'en']], ['inexpensive', [['low'], 'en']], ['affordable', [['low'], 'en']], ['expensive', [['high'], 'en']], ['luxury', [['high'], 'en']],
] as [string, [Price[], 'es' | 'en']][])

// Citas que traen el estilo: una tranqui o descontracturada es casual; una romántica o especial, cuidado. "cita" sola es sólo date.
// also: otra frase del catálogo que la consulta también pide, resuelta igual que si viniera sola ("cena romántica" → "cena").
const DATE_STYLES = new Map<string, { style: StyleId; also?: string; language?: 'en' }>([
  ...['primera cita', 'algo tranqui para una cita', 'cita tranqui', 'cita descontracturada', 'cita informal'].map((phrase) => [phrase, { style: 'casual' }] as const),
  ...['aniversario', 'cita especial', 'cita romantica'].map((phrase) => [phrase, { style: 'cuidado' }] as const),
  ['cena romantica', { style: 'cuidado', also: 'cena' }],
  ['anniversary', { style: 'cuidado', language: 'en' }],
])

// Almuerzo de trabajo: almorzar (el sub Almuerzo de Comer) y, como preferencia, menú del día y algo rápido. No es work,
// que es trabajar con la compu; menu_of_the_day sola sería requisito.
const WORK_LUNCH_PHRASES = new Map<string, 'es' | 'en'>([
  ...['almuerzo de trabajo', 'almuerzos de trabajo', 'almuerzo ejecutivo', 'almorzar cerca del trabajo'].map((phrase) => [phrase, 'es'] as const),
  ['work lunch', 'en'], ['business lunch', 'en'],
])

// Frente al mar: sea_view como preferencia (lo calcula el backoffice por la distancia a la Rambla). Sin esto, el
// sinónimo "rambla" de FEATURES lo volvería obligatorio.
const SEA_VIEW_PHRASES = new Set([
  'frente al mar', 'vista al mar', 'cerca del mar', 'sobre la costa', 'sobre la rambla', 'en la rambla', 'cerca de la rambla', 'la rambla', 'rambla',
])

// Ir con amigos o en grupo, sin distinguir grupo grande o chico: groups como preferencia, sin pasar por el modelo. Van acá
// y no como sinónimos en shared/tags.ts, que entran en los textos guardados de los lugares. "con la barra" gana por ser
// más larga que "barra", sinónimo de solo.
const GROUP_PHRASES = new Map<string, 'es' | 'en'>([
  ...[
    'con amigas', 'con mis amigos', 'con mis amigas', 'entre amigos', 'entre amigas', 'para ir con amigos', 'para ir con amigas',
    'salir con amigos', 'salir con amigas', 'amigos', 'amigas', 'juntada', 'juntada con amigos', 'para juntarse', 'grupo',
    'para un grupo', 'grupo grande', 'para un grupo grande', 'grupos grandes', 'mesa grande', 'con los pibes', 'con las pibas', 'con la barra',
  ].map((phrase) => [phrase, 'es'] as const),
  ['big group', 'en'],
])

// Ir con los padres: no es kids_friendly. Comer, tranquilo y cuidado, y lo de la noche baja (fuse.ts avoidNight).
const PARENT_PHRASES = new Set(['con mis viejos', 'con mis padres', 'mis viejos', 'mis padres', 'para ir con mis viejos', 'para ir con mis padres'])

// Atardecer: lugares con vista o al aire libre, siempre como preferencia.
const SUNSET_PHRASES = new Set([
  'atardecer', 'el atardecer', 'al atardecer', 'ver el atardecer', 'para ver el atardecer',
  'puesta de sol', 'la puesta de sol', 'ver la puesta de sol', 'para ver la puesta de sol',
])
const SUNSET_TAGS = ['sea_view', 'rooftop', 'terrace']

const hasPhrase = (phrases: Set<string>, normalized: string) => {
  const text = ` ${normalized} `
  return [...phrases].some((phrase) => text.includes(` ${phrase} `))
}

/** La consulta habla de ir con los padres ("algo para ir con mis viejos"). */
export const mentionsParents = (normalized: string) => hasPhrase(PARENT_PHRASES, normalized)

// Verbos que piden una intención sin nombrar un tag ("comer", "tomar algo"). Se miran antes que el catálogo, así
// "tomar algo" es sólo Bares y no exige el tag drinks; una frase más larga del catálogo ("comer de noche") gana igual.
const VERBS = new Map<string, [IntentId, 'es' | 'en']>(INTENT_VERBS.map(([phrase, id, lang]) => [normalize(phrase), [id, lang]]))

// Platos genéricos sin tag propio en el catálogo: van como plato con su respaldo, sin pasar por el modelo.
// pescado, mariscos y pollo no hacen falta: son sinónimos de seafood y chicken.
type GenericDish = { relatedTags: string[]; relatedCategories: string[]; language: 'es' | 'en' }
const MEAT = (language: 'es' | 'en'): GenericDish => ({ relatedTags: ['grilled_meat'], relatedCategories: ['grill'], language })
const GENERIC_DISHES = new Map<string, GenericDish>([['carne', MEAT('es')], ['carnes', MEAT('es')], ['meat', MEAT('en')]])

// "sin carne": exclude de la carne (y de las parrillas por ícono, search.ts), con los vegetarianos arriba; no filtra por
// dieta. Va antes que "carne" (frase más larga) y que la negación suelta "sin".
const MEATLESS_PHRASES = new Set(['sin carne', 'sin carnes'])

// "pizza a la leña": el plato pizza y el horno a leña (la frase es sinónimo de wood_fired_oven, que sola perdería la pizza).
const COMBINED_PHRASES = new Map<string, readonly string[]>(
  ['pizza a la lena', 'pizzas a la lena'].map((phrase) => [phrase, ['pizza', 'horno a lena']]),
)

// Tenedor libre dicho con la comida: "sushi libre", "parrilla libre", "comer libre". "libre" suelto, "aire libre",
// "barra libre" o "libre de gluten" no: lo que va antes de "libre" tiene que ser una comida, una cocina o comer.
const EAT_WORDS = new Set(['comer', 'comida', 'comidas'])
const FOOD_GROUPS = new Set(['foods', 'cuisines', 'categories'])
function allYouCanEatFood(phrase: string): string | null {
  if (!phrase.endsWith(' libre')) return null
  const food = phrase.slice(0, -' libre'.length)
  if (EAT_WORDS.has(food)) return food
  const found = canonicalOf(food)
  return found && (FOOD_GROUPS.has(found.group) || found.dish) ? food : null
}
export const ALL_YOU_CAN_EAT = 'all_you_can_eat'

// "milanesa al pan", "bondiola al pan": el plato y, como preferencia, sándwiches. Sin esto "al pan" quedaba sin
// reconocer. Lo que va antes tiene que ser una comida del catálogo; si no ("bondiola"), lo lee el modelo y applyDictionary
// suma la preferencia.
const ON_BREAD = ' al pan'
const ON_BREAD_TAG = 'sandwiches'
function onBreadFood(phrase: string): string | null {
  if (!phrase.endsWith(ON_BREAD)) return null
  const food = phrase.slice(0, -ON_BREAD.length)
  const found = food ? canonicalOf(food) : null
  return found && (found.group === 'foods' || found.dish) ? food : null
}
const mentionsOnBread = (normalized: string) => ` ${normalized} `.includes(`${ON_BREAD} `)

// "para compartir": lo que se comparte (picadas, tablas, tapas: las señales del grupo Para compartir), como preferencia.
// Es sinónimo de picada en shared/tags.ts y sin esto salía como un segundo plato ("Puede que tengan para compartir").
// No hay un tag sharing en el catálogo.
const SHARE_PHRASES = new Map<string, 'es' | 'en'>([['para compartir', 'es'], ['for sharing', 'en']])
const SHARE_TAGS = ['picada', 'tapas']

// Vino por copa: el tag wine (en un bar, el sub-filtro Vinos), no la categoría vinoteca obligatoria, que dejaba sólo
// las vinotecas. "vinos por copa" sigue siendo sinónimo de wine_bar en shared/tags.ts (entra en los textos guardados).
const WINE_GLASS_PHRASES = new Map<string, 'es' | 'en'>([
  ...['vino por copa', 'vinos por copa', 'vino por la copa', 'vinos por la copa', 'vino en copa', 'vinos en copa', 'copas de vino'].map((phrase) => [phrase, 'es'] as const),
  ['wine by the glass', 'en'],
])
const WINE_TAG = 'wine'

/**
 * Sinónimos del catálogo que el diccionario resuelve distinto a su tag ("vinos por copa" es sinónimo de wine_bar pero va
 * como el tag wine; "para compartir", de picada, va como preferencia). Los tests generados desde tags.ts los saltean.
 */
export const REROUTED_PHRASES: ReadonlySet<string> = new Set([...WINE_GLASS_PHRASES.keys(), ...SHARE_PHRASES.keys()])

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
export const NEGATIONS = new Set(['no', 'ni', 'sin', 'excepto', 'salvo', 'menos', 'not', 'except', 'without'])

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
      const workLunch = WORK_LUNCH_PHRASES.get(phrase)
      const verb = VERBS.get(phrase)
      const genericDish = GENERIC_DISHES.get(phrase)
      const combined = COMBINED_PHRASES.get(phrase)
      const freeFood = allYouCanEatFood(phrase)
      const groupPhrase = GROUP_PHRASES.get(phrase)
      const onBread = onBreadFood(phrase)
      const share = SHARE_PHRASES.get(phrase)
      const wineGlass = WINE_GLASS_PHRASES.get(phrase)
      if (onBread) {
        applyTerm(target, onBread)
        target.prefer.tags.push(ON_BREAD_TAG)
        votes.es++
      } else if (share) {
        target.prefer.tags.push(...SHARE_TAGS)
        votes[share]++
      } else if (wineGlass) {
        target.must.tags.push(WINE_TAG)
        votes[wineGlass]++
      } else if (groupPhrase) {
        target.prefer.tags.push('groups')
        votes[groupPhrase]++
      } else if (PARENT_PHRASES.has(phrase)) {
        target.intent ??= 'eat'
        target.prefer.tags.push('quiet')
        target.prefer.style ??= 'cuidado'
        votes.es++
      } else if (SUNSET_PHRASES.has(phrase)) {
        target.prefer.tags.push(...SUNSET_TAGS)
        votes.es++
      } else if (MEATLESS_PHRASES.has(phrase)) {
        target.exclude.tags.push(MEAT_TAG)
        votes.es++
      } else if (SEA_VIEW_PHRASES.has(phrase)) {
        target.prefer.tags.push('sea_view')
        votes.es++
      } else if (neighborhood) {
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
      } else if (workLunch) {
        target.must.tags.push('lunch')
        target.prefer.tags.push('menu_of_the_day', 'quick')
        votes[workLunch]++
      } else if (verb) {
        target.intent ??= verb[0]
        votes[verb[1]]++
      } else if (combined) {
        for (const part of combined) applyTerm(target, part)
        votes.es++
      } else if (freeFood) {
        if (!EAT_WORDS.has(freeFood)) applyTerm(target, freeFood)
        target.must.tags.push(ALL_YOU_CAN_EAT)
        votes.es++
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

// Lo que el diccionario reconoce seguro y se suma a lo del modelo: comidas del día y tenedor libre (requisito, como
// los pide el modelo) y vista al mar, momentos y lo del almuerzo de trabajo (preferencias).
const MEAL_TAGS = new Set(['breakfast', 'brunch', 'lunch', 'afternoon_snack', 'dinner'])
const PREFER_TAGS = new Set<string>(['sea_view', 'menu_of_the_day', ...OCCASION_TAGS])

/** Suma una interpretación a otra: listas unidas; lo que es uno solo (horario, estilo, intención) sólo si faltaba. */
function merge(into: Interpretation, from: Interpretation) {
  into.must.categories.push(...from.must.categories)
  into.must.tags.push(...from.must.tags)
  into.must.neighborhoods.push(...from.must.neighborhoods)
  into.must.price.push(...from.must.price)
  Object.assign(into.must.diet, from.must.diet)
  into.must.openAt ??= from.must.openAt
  into.prefer.categories.push(...from.prefer.categories)
  into.prefer.tags.push(...from.prefer.tags)
  into.prefer.style ??= from.prefer.style
  into.exclude.categories.push(...from.exclude.categories)
  into.exclude.tags.push(...from.exclude.tags)
  into.dishes.push(...from.dishes)
  into.intent ??= from.intent
  into.wantsBest ||= from.wantsBest
}

/**
 * Las frases del diccionario también sobre lo que devolvió el modelo, como applyWhen con el horario: vista al mar,
 * comidas del día, momentos, estilo e intención se suman (lo negado no: modo parcial). Una cocina del texto ("algo
 * asiático") que el modelo no puso en ningún lado va como requisito, y "sin carne" es exclude de la carne aunque el
 * modelo la haya hecho dieta vegetariana. Una parte que el modelo dejó sin
 * reconocer y el diccionario entiende entera ("cerca de la rambla") se aplica completa y deja de estar sin reconocer;
 * "cerca mío" sigue ahí, porque pide la ubicación.
 */
export function applyDictionary(value: Interpretation, normalized: string): Interpretation {
  const read = interpretWithDictionary(normalized, { partial: true })
  if (!read) return value
  const next: Interpretation = structuredClone(value)
  next.must.tags.push(...read.must.tags.filter((id) => MEAL_TAGS.has(id) || id === ALL_YOU_CAN_EAT))
  next.prefer.tags.push(...read.prefer.tags.filter((id) => PREFER_TAGS.has(id)))
  next.prefer.style ??= read.prefer.style
  next.intent ??= read.intent
  const mentioned = new Set([...value.must.tags, ...value.prefer.tags, ...value.exclude.tags, ...value.dishes.flatMap((dish) => dish.relatedTags)])
  next.must.tags.push(...read.must.tags.filter((id) => Object.hasOwn(CUISINES, id) && !mentioned.has(id)))
  if (read.exclude.tags.includes(MEAT_TAG)) {
    next.exclude.tags.push(MEAT_TAG)
    if (!read.must.diet.vegetarian) delete next.must.diet.vegetarian
  }
  // "al pan", "para compartir" y "vino por copa" valen aunque el modelo los haya leído de otra forma.
  if (mentionsOnBread(normalized)) next.prefer.tags.push(ON_BREAD_TAG)
  if (hasPhrase(new Set(SHARE_PHRASES.keys()), normalized)) {
    next.prefer.tags.push(...SHARE_TAGS)
    next.dishes = next.dishes.filter((dish) => !SHARE_PHRASES.has(normalizeQuery(dish.name)))
  }
  if (hasPhrase(new Set(WINE_GLASS_PHRASES.keys()), normalized)) {
    next.must.categories = next.must.categories.filter((id) => id !== 'wine_bar')
    next.prefer.categories = next.prefer.categories.filter((id) => id !== 'wine_bar')
    next.must.tags.push(WINE_TAG)
  }
  // Vista al mar es preferencia aunque el modelo la haya exigido (sinónimo "rambla").
  if (read.prefer.tags.includes('sea_view')) next.must.tags = next.must.tags.filter((id) => id !== 'sea_view')
  next.unrecognized = value.unrecognized.filter((part) => {
    if (normalizeQuery(part) === ON_BREAD.trim()) return false
    const whole = interpretWithDictionary(normalizeQuery(part))
    if (!whole || whole.needsLocation) return true
    merge(next, whole)
    return false
  })
  // Con los padres, lo que el modelo leyó como niños no vale, salvo que el texto también los nombre.
  if (mentionsParents(normalized)) {
    next.prefer.tags.push('quiet')
    if (!read.prefer.tags.includes('kids_friendly')) {
      next.must.tags = next.must.tags.filter((id) => id !== 'kids_friendly')
      next.prefer.tags = next.prefer.tags.filter((id) => id !== 'kids_friendly')
    }
  }
  // Con el atardecer, la vista y el aire libre ordenan: nunca filtran.
  if (hasPhrase(SUNSET_PHRASES, normalized)) {
    next.must.tags = next.must.tags.filter((id) => !SUNSET_TAGS.includes(id))
    next.prefer.tags.push(...SUNSET_TAGS)
  }
  return tidy(next)
}
