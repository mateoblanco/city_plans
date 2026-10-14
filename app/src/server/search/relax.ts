import { intentDef, type IntentId } from '@shared/intents.ts'
import { SEARCH_CONFIG } from './config'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import type { CandidateRow, DishMode } from './candidates'
import { hasBroaderRelated, relatedLabel, type DishTarget } from './dishes'
import { openStatus, type Moment } from './hours'
import { intentGroups, matchesGroup, subTerms } from './intents'
import { DIET_KEYS, type DietKey, type Interpretation, type Lang } from './interpretation'
import { DAY_NAMES, dietLabel, distanceText, excludedTerm } from './labels'

// Orden fijo: los tags de must primero porque sus datos están incompletos; después los sub-filtros de la
// intención (pasan a preferencias); el barrio después porque para la persona pesa más. similarity es el último recurso.
// Nunca se relajan la dieta, los exclude ni la intención.
// Con "cerca mío", el radio se amplía (1,5 → 3 → 5 km) antes de soltar el barrio o el horario.
export const RELAX_ORDER = ['mustTags', 'subs', 'dishRelated', 'radius', 'radiusMax', 'neighborhood', 'openAt', 'similarity'] as const
export type RelaxStep = (typeof RELAX_ORDER)[number]
export type NoticeKind = RelaxStep | 'noMatch'

/**
 * nearRadius: radio de "cerca mío" en metros; null sin ubicación o cuando ya no filtra.
 * intent / subs: intención y sub-filtros activos (de la URL o del texto).
 */
export type SearchState = { interpretation: Interpretation; dishMode: DishMode; nearRadius: number | null; intent: IntentId | null; subs: string[] }

const RADII = SEARCH_CONFIG.near.radii
const NEXT_RADIUS = { radius: RADII[1], radiusMax: RADII[2] } as const

export function canRelax({ interpretation: value, dishMode, nearRadius, subs }: SearchState, step: RelaxStep, dishes: DishTarget[]) {
  const { must } = value
  if (step === 'subs') return subs.length > 0
  if (step === 'radius' || step === 'radiusMax') return nearRadius !== null && nearRadius < NEXT_RADIUS[step]
  if (step === 'mustTags') return must.tags.length > 0
  if (step === 'dishRelated') return dishMode === 'dish' && dishes.some(hasBroaderRelated)
  if (step === 'neighborhood') return must.neighborhoods.length > 0
  if (step === 'openAt') return must.openAt !== null
  return (
    (dishes.length > 0 && dishMode !== 'none') ||
    must.categories.length + must.tags.length + must.neighborhoods.length + must.price.length > 0 ||
    must.openAt !== null ||
    nearRadius !== null
  )
}

export function relax(state: SearchState, step: RelaxStep): SearchState {
  const value = state.interpretation
  const mustTagsToPrefer = { ...value.prefer, tags: [...new Set([...value.prefer.tags, ...value.must.tags])] }
  if (step === 'mustTags') return { ...state, interpretation: { ...value, must: { ...value.must, tags: [] }, prefer: mustTagsToPrefer } }
  if (step === 'subs') {
    const terms = subTerms(state.intent, state.subs)
    const prefer = {
      categories: [...new Set([...value.prefer.categories, ...terms.categories])],
      tags: [...new Set([...value.prefer.tags, ...terms.tags])],
    }
    return { ...state, subs: [], interpretation: { ...value, prefer } }
  }
  if (step === 'dishRelated') return { ...state, dishMode: 'related' }
  if (step === 'radius' || step === 'radiusMax') return { ...state, nearRadius: NEXT_RADIUS[step] }
  if (step === 'neighborhood') return { ...state, interpretation: { ...value, must: { ...value.must, neighborhoods: [] } } }
  if (step === 'openAt') return { ...state, interpretation: { ...value, must: { ...value.must, openAt: null } } }
  // similarity: sólo quedan la dieta y los exclude; lo pedido sigue sumando como preferencia y la distancia ordena.
  return {
    ...state,
    dishMode: 'none',
    nearRadius: null,
    interpretation: {
      ...value,
      must: { ...value.must, categories: [], tags: [], neighborhoods: [], price: [], openAt: null },
      prefer: { categories: [...new Set([...value.prefer.categories, ...value.must.categories])], tags: mustTagsToPrefer.tags },
    },
  }
}

const list = (values: string[], lang: Lang, joiner = lang === 'es' ? 'y' : 'and') => {
  if (values.length <= 1) return values.join('')
  return `${values.slice(0, -1).join(', ')} ${joiner} ${values.at(-1)}`
}

const neighborhoodNames = (ids: string[], lang: Lang) => list(ids.map((id) => neighborhoodDisplayName(id) ?? id), lang)

export type NoticeContext = {
  /** Estado antes de aplicar el paso. */
  before: SearchState
  /** Estado final, con el que se buscó. */
  after: SearchState
  /** Lo que se devuelve: los avisos sólo nombran lo que de verdad no cumple. */
  rows: CandidateRow[]
  dishes: DishTarget[]
  /** Momento de openAt antes de relajarlo. */
  moment: Moment | null
}

/** Aviso de un paso de relajación; null si ningún resultado deja de cumplir lo que se relajó. */
export function relaxNotice(step: RelaxStep, context: NoticeContext): { what: NoticeKind; message: string } | null {
  const value = context.before.interpretation
  const lang = value.language
  const es = lang === 'es'
  const { rows } = context

  // Un tag obligatorio que pasa a preferencia no se avisa: sigue ordenando y no está en la barra.
  if (step === 'mustTags') return null

  if (step === 'subs') {
    const { intent, subs } = context.before
    const groups = intentGroups(intent, subs).slice(1)
    if (!intent || !rows.some((row) => groups.some((group) => !matchesGroup(group, row)))) return null
    const definition = intentDef(intent)
    const phrases = subs.flatMap((id) => (definition.subs[id] ? [definition.subs[id].phrase[lang]] : []))
    const noun = definition.noun[lang]
    const what = `${noun} ${list(phrases, lang)}`
    const message = subs.length === 1
      ? es ? `No encontramos ${what}; estos son los más parecidos.` : `No ${what}; these are the closest matches.`
      : es ? `No encontramos ${what}; estos tienen algo de eso.` : `No ${what}; these have some of it.`
    return { what: step, message }
  }

  if (step === 'dishRelated') {
    const dishes = list(context.dishes.map((target) => target.dish), lang, es ? 'ni' : 'or')
    const relatedIds = [...new Set(context.dishes.flatMap((target) => [...target.related.tags, ...target.related.categories]))]
    const present = relatedIds.filter((id) => rows.some((row) => row.tags.includes(id) || row.categories.includes(id)))
    const neighborhoods = context.after.interpretation.must.neighborhoods
    const where = neighborhoods.length ? ` ${es ? 'en' : 'in'} ${neighborhoodNames(neighborhoods, lang)}` : ''
    // En inglés los gentilicios van con mayúscula ("Peruvian cuisine"): sólo se pasa a minúscula en español.
    const labels = list(present.map((id) => (es ? relatedLabel(id, lang).toLowerCase() : relatedLabel(id, lang))), lang, es ? 'o' : 'or')
    const message = labels
      ? es ? `No hay ${dishes}${where}, pero estos tienen ${labels}.` : `No ${dishes}${where}, but these have ${labels}.`
      : es ? `No hay ${dishes}${where}; estos son los más parecidos.` : `No ${dishes}${where}; these are the closest matches.`
    return { what: step, message }
  }

  // Un solo aviso por la ampliación del radio, del radio inicial al último que se usó.
  if (step === 'radiusMax') return null
  if (step === 'radius') {
    const previous = context.before.nearRadius
    if (previous === null || !rows.some((row) => row.distance !== null && row.distance > previous)) return null
    const [from, to] = [distanceText(previous, lang), distanceText(context.after.nearRadius ?? RADII[RADII.length - 1], lang)]
    return {
      what: step,
      message: es ? `No encontramos a menos de ${from}; estos están a hasta ${to}.` : `Nothing within ${from}; these are up to ${to} away.`,
    }
  }

  if (step === 'neighborhood') {
    const wanted = value.must.neighborhoods
    if (!rows.some((row) => !wanted.includes(row.neighborhoodId))) return null
    const names = neighborhoodNames(wanted, lang)
    return { what: step, message: es ? `No encontramos en ${names}; estos están cerca.` : `Nothing in ${names}; these are nearby.` }
  }

  if (step === 'openAt') {
    const moment = context.moment
    if (!moment || !rows.some((row) => openStatus(row.hours, moment).state === 'closed')) return null
    const when = whenText(value.must.openAt === 'now' ? 'now' : moment, lang)
    return {
      what: step,
      message: es ? `No hay nada abierto ${when}; te mostramos también los cerrados.` : `Nothing open ${when}; showing closed places too.`,
    }
  }

  return {
    what: step,
    message: es ? 'No encontramos exactamente lo que buscás; estos son los más parecidos.' : "We couldn't find exactly what you're looking for; these are the closest matches.",
  }
}

/** "ahora", "el domingo", "el domingo a las 21:00" / "now", "on Sunday at 21:00". */
function whenText(moment: Moment | 'now', lang: Lang) {
  const es = lang === 'es'
  if (moment === 'now') return es ? 'ahora' : 'now'
  const day = es ? `el ${DAY_NAMES.es[moment.day]}` : `on ${DAY_NAMES.en[moment.day]}`
  return moment.time ? `${day} ${es ? 'a las' : 'at'} ${moment.time}` : day
}

const DIET_WORDS: Record<Lang, Record<DietKey, string>> = {
  es: { vegan: 'veganas', vegetarian: 'vegetarianas', glutenFree: 'sin TACC' },
  en: { vegan: 'vegan', vegetarian: 'vegetarian', glutenFree: 'gluten-free' },
}

/**
 * Aviso cuando ni el último recurso encuentra nada: nombra la dieta y/o los exclude que bloquean. La dieta está
 * en la barra de filtros, así que se sugiere sacarla de ahí; los exclude sólo se cambian editando el texto.
 */
export function noMatchNotice(value: Interpretation, blocking: { diet: boolean; exclude: boolean; intent?: boolean }, intent: IntentId | null = null) {
  const lang = value.language
  const es = lang === 'es'
  const noun = intent ? intentDef(intent).noun[lang] : null
  // La intención sola no tiene lugares (por ejemplo, todavía no hay ninguno destacado).
  if (noun && blocking.intent && !blocking.diet && !blocking.exclude) {
    return {
      what: 'noMatch' as const,
      message: es ? `Todavía no hay ${noun}. Probá con otra opción.` : `There are no ${noun} yet. Try another option.`,
    }
  }
  const dietKeys = blocking.diet ? DIET_KEYS.filter((key) => value.must.diet[key]) : []
  const diet = dietKeys.map((key) => DIET_WORDS[lang][key])
  const excluded = blocking.exclude ? [...value.exclude.categories, ...value.exclude.tags].map((id) => excludedTerm(id, lang)) : []
  const withDiet = diet.length ? (es ? ` con opciones ${list(diet, lang)} confirmadas` : ` with confirmed ${list(diet, lang)} options`) : ''
  const notExcluded = excluded.length ? (es ? ` que no sean ${list(excluded, lang, 'ni')}` : ` that aren't ${list(excluded, lang, 'or')}`) : ''
  const filters = list(dietKeys.map((key) => dietLabel(key, lang)), lang, es ? 'o' : 'or')
  const hint = filters ? (es ? ` Probá sacar ${filters} de los filtros.` : ` Try removing ${filters} from the filters.`) : ''
  const message = withDiet || notExcluded
    ? es ? `No encontramos ${noun ?? 'lugares'}${withDiet}${notExcluded}.${hint}` : `We couldn't find ${noun ?? 'places'}${withDiet}${notExcluded}.${hint}`
    : es ? 'Todavía no hay lugares publicados.' : 'There are no published places yet.'
  return { what: 'noMatch' as const, message }
}
