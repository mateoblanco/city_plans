import type { CategoryId, Lang, TagId } from './tags.ts'

/**
 * Intenciones de /search: qué quiere hacer la persona. Cada una dice qué lugares entran (cualquiera de sus
 * categorías o tags, o featured) y qué sub-filtros muestra. Las categorías y tags son los de tags.ts.
 *
 * - aliases: categorías que en el texto significan la intención misma ("bares" → Bares). La intención las cubre.
 * - detect: tags que, escritos en el texto, también eligen la intención (además de los de sus sub-filtros).
 * - noun / sub.phrase: para los avisos ("No encontramos bares con tragos y con música en vivo").
 */
export type IntentMatch = { categories?: CategoryId[]; tags?: TagId[]; featured?: boolean }

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
  subs: Record<string, SubFilterDef>
}

const sub = (es: string, en: string, phraseEs: string, phraseEn: string, match: IntentMatch): SubFilterDef => ({
  label: { es, en },
  phrase: { es: phraseEs, en: phraseEn },
  ...match,
})

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
    match: { categories: ['restaurant', 'grill', 'pizzeria', 'chiviteria', 'bodegon'] },
    aliases: ['restaurant'],
    detect: ['menu_of_the_day', 'all_you_can_eat'],
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

export const isIntentId = (value: string): value is IntentId => value in INTENTS
export const intentDef = (id: IntentId): IntentDef => INTENTS[id]
