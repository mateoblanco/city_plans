import { CUISINES, FOODS, type CategoryId, type Lang, type TagId } from './tags.ts'

/**
 * Intenciones de /search: qué quiere hacer la persona. Cada una dice qué lugares entran (cualquiera de sus
 * categorías o tags, o featured) y qué sub-filtros muestra. Las categorías y tags son los de tags.ts.
 *
 * - aliases: categorías que en el texto significan la intención misma ("bares" → Bares). La intención las cubre.
 * - detect: tags que, escritos en el texto, también eligen la intención (además de los de sus sub-filtros).
 * - verbs: frases que piden la intención sin nombrar un tag ("comer", "tomar algo"). Votan como un tag y no filtran
 *   nada más que la intención. Los verbos con tag propio (almorzar → lunch) van como sinónimos del tag, no acá.
 * - noun / sub.phrase: para los avisos ("No encontramos bares con tragos y con música en vivo").
 */
/** all: además, cualquiera de estos pares "alguna de las categorías y alguno de los tags" (un bar con comida). */
export type IntentMatch = { categories?: CategoryId[]; tags?: TagId[]; featured?: boolean; all?: { categories: CategoryId[]; tags: TagId[] }[] }

export type SubFilterDef = IntentMatch & {
  label: Record<Lang, string>
  phrase: Record<Lang, string>
}

export type IntentDef = {
  label: Record<Lang, string>
  noun: Record<Lang, string>
  match: IntentMatch
  aliases: CategoryId[]
  detect: TagId[]
  verbs: Record<Lang, string[]>
  subs: Record<string, SubFilterDef>
}

const sub = (es: string, en: string, phraseEs: string, phraseEn: string, match: IntentMatch): SubFilterDef => ({
  label: { es, en },
  phrase: { es: phraseEs, en: phraseEn },
  ...match,
})

/** Lo que hace que un bar también sea un lugar para comer: algún plato o cocina. */
const FOOD_TAGS = [...Object.keys(FOODS), ...Object.keys(CUISINES)] as TagId[]

export const INTENTS = {
  // top: {
  //   label: { es: 'Top picks', en: 'Top picks' },
  //   noun: { es: 'top picks', en: 'top picks' },
  //   match: { featured: true },
  //   aliases: [],
  //   detect: [],
  //   subs: {},
  // },
  eat: {
    label: { es: 'Comer', en: 'Eat' },
    noun: { es: 'lugares para comer', en: 'places to eat' },
    // Un bar con comida (Demodé, Bar Kfe) también es para comer; uno sólo de tragos o un boliche, no.
    match: { categories: ['restaurant', 'grill', 'pizzeria', 'chiviteria', 'bodegon'], all: [{ categories: ['bar', 'brewery', 'wine_bar'], tags: FOOD_TAGS }] },
    aliases: ['restaurant'],
    detect: ['menu_of_the_day', 'all_you_can_eat'],
    verbs: { es: ['comer', 'salir a comer', 'para comer', 'algo para comer', 'algo de comer'], en: ['eat', 'to eat', 'grab food', 'grab a bite'] },
    subs: {
      breakfast: sub('Desayuno', 'Breakfast', 'con desayuno', 'serving breakfast', { tags: ['breakfast'] }),
      brunch: sub('Brunch', 'Brunch', 'con brunch', 'serving brunch', { tags: ['brunch'] }),
      lunch: sub('Almuerzo', 'Lunch', 'para almorzar', 'for lunch', { tags: ['lunch'] }),
      dinner: sub('Cena', 'Dinner', 'para cenar', 'for dinner', { tags: ['dinner'] }),
    },
  },
  cafes: {
    label: { es: 'Cafés', en: 'Cafés' },
    noun: { es: 'cafés', en: 'cafés' },
    match: { categories: ['cafe', 'bakery'] },
    aliases: ['cafe'],
    detect: ['afternoon_snack', 'tea'],
    verbs: { es: ['tomar un cafe', 'tomar un cafecito', 'un cafecito', 'tomar cafe'], en: ['grab a coffee', 'have a coffee'] },
    subs: {
      specialty: sub('Especialidad', 'Specialty', 'de especialidad', 'with specialty coffee', { tags: ['specialty_coffee'] }),
      pastries: sub('Pastelería', 'Pastries', 'con pastelería', 'with pastries', { tags: ['pastries'] }),
      brunch: sub('Brunch', 'Brunch', 'con brunch', 'serving brunch', { tags: ['brunch'] }),
      work: sub('Para trabajar', 'To work', 'para trabajar', 'to work from', { tags: ['work'] }),
    },
  },
  bars: {
    label: { es: 'Bares', en: 'Bars' },
    noun: { es: 'bares', en: 'bars' },
    match: { categories: ['bar', 'brewery', 'wine_bar', 'night_club'] },
    aliases: ['bar'],
    detect: ['drinks', 'late_night', 'happy_hour', 'after_office', 'vermouth', 'gin', 'whisky', 'cider', 'medio_y_medio'],
    verbs: {
      es: ['tomar algo', 'salir a tomar algo', 'salir a tomar', 'tomar unas cervezas', 'tomar unas birras', 'unas cervezas', 'unas birras', 'unos tragos', 'tomar unos tragos', 'tomar unos vinos'],
      en: ['grab a drink', 'have drinks', 'have a drink', 'get drinks'],
    },
    subs: {
      cocktails: sub('Tragos', 'Drinks', 'con tragos', 'with drinks', { tags: ['signature_cocktails', 'classic_cocktails'] }),
      wine: sub('Vinos', 'Wine', 'con vinos', 'with wine', { tags: ['wine'] }),
      beer: sub('Cerveza', 'Beer', 'con cerveza', 'with beer', { tags: ['craft_beer', 'draft_beer'] }),
      live_music: sub('Música en vivo', 'Live music', 'con música en vivo', 'with live music', { tags: ['live_music'] }),
      live_sports: sub('Deportes en vivo', 'Live sports', 'con deportes en vivo', 'showing live sports', { tags: ['watch_football'] }),
      dancing: sub('Para bailar', 'Dancing', 'para bailar', 'for dancing', { categories: ['night_club'], tags: ['dj'] }),
    },
  },
  desserts: {
    label: { es: 'Postres', en: 'Desserts' },
    noun: { es: 'lugares de postres', en: 'dessert places' },
    match: { categories: ['ice_cream_shop'], tags: ['desserts', 'ice_cream'] },
    aliases: ['ice_cream_shop'],
    detect: [],
    verbs: { es: ['comer un postre', 'comer algo dulce', 'algo dulce', 'tomar un helado', 'comer un helado'], en: ['something sweet', 'grab dessert'] },
    subs: {
      ice_cream: sub('Helado', 'Ice cream', 'con helado', 'with ice cream', { categories: ['ice_cream_shop'], tags: ['ice_cream'] }),
      pastries: sub('Pastelería', 'Pastries', 'con pastelería', 'with pastries', { tags: ['pastries', 'desserts'] }),
    },
  },
} satisfies Record<string, IntentDef>

export type IntentId = keyof typeof INTENTS
export const INTENT_IDS = Object.keys(INTENTS) as IntentId[]

/**
 * Categorías que a propósito no pertenecen a ninguna intención (el texto las sigue usando como filtro). Toda
 * categoría de tags.ts tiene que estar en el match de una intención o acá: lo verifica intents.test.ts.
 */
export const NO_INTENT_CATEGORIES: CategoryId[] = []

/** Intención donde cae un plato que no coincide con ninguna otra. */
export const DEFAULT_DISH_INTENT: IntentId = 'eat'

/** Frase normalizada (sin acentos) → intención, para el diccionario y el intérprete. */
export const INTENT_VERBS: [string, IntentId, Lang][] = (Object.entries(INTENTS) as [IntentId, IntentDef][]).flatMap(([id, intent]) =>
  (Object.entries(intent.verbs) as [Lang, string[]][]).flatMap(([lang, phrases]) => phrases.map((phrase) => [phrase, id, lang] as [string, IntentId, Lang])),
)

export const isIntentId = (value: string): value is IntentId => value in INTENTS
export const intentDef = (id: IntentId): IntentDef => INTENTS[id]
