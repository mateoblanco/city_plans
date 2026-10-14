import { label } from '@shared/tags.ts'
import { SEARCH_CONFIG } from './config'
import { neighborhoodDisplayName } from '@shared/neighborhood-names.ts'
import type { CandidateRow, DishMode } from './candidates'
import { hasBroaderRelated, relatedLabel, type DishTarget } from './dishes'
import { openStatus, type Moment } from './hours'
import { DIET_KEYS, type DietKey, type Interpretation, type Lang } from './interpretation'
import { distanceText, excludedTerm } from './labels'

// Orden fijo: los tags de must primero porque sus datos están incompletos; el barrio después
// porque para la persona pesa más. similarity es el último recurso.
// Nunca se relajan la dieta ni los exclude.
// Con "cerca mío", el radio se amplía (1,5 → 3 → 5 km) antes de soltar el barrio o el horario.
export const RELAX_ORDER = ['mustTags', 'dishRelated', 'radius', 'radiusMax', 'neighborhood', 'openAt', 'similarity'] as const
export type RelaxStep = (typeof RELAX_ORDER)[number]
export type NoticeKind = RelaxStep | 'noMatch'

/** nearRadius: radio de "cerca mío" en metros; null sin ubicación o cuando ya no filtra. */
export type SearchState = { interpretation: Interpretation; dishMode: DishMode; nearRadius: number | null }

const RADII = SEARCH_CONFIG.near.radii
const NEXT_RADIUS = { radius: RADII[1], radiusMax: RADII[2] } as const

export function canRelax({ interpretation: value, dishMode, nearRadius }: SearchState, step: RelaxStep, dishes: DishTarget[]) {
  const { must } = value
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
  if (step === 'dishRelated') return { ...state, dishMode: 'related' }
  if (step === 'radius' || step === 'radiusMax') return { ...state, nearRadius: NEXT_RADIUS[step] }
  if (step === 'neighborhood') return { ...state, interpretation: { ...value, must: { ...value.must, neighborhoods: [] } } }
  if (step === 'openAt') return { ...state, interpretation: { ...value, must: { ...value.must, openAt: null } } }
  // similarity: sólo quedan la dieta y los exclude; lo pedido sigue sumando como preferencia y la distancia ordena.
  return {
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

  if (step === 'mustTags') {
    const missing = value.must.tags.filter((id) => rows.some((row) => !row.tags.includes(id)))
    if (!missing.length) return null
    const names = list(missing.map((id) => label(id, lang).toLowerCase()), lang)
    const plural = missing.length > 1
    return {
      what: step,
      message: es
        ? `No todos los lugares tienen ${names}: ${plural ? 'pasaron a ser preferencias' : 'pasó a ser una preferencia'}.`
        : `Not every place has ${names}: ${plural ? 'they are now preferences' : 'it is now a preference'}.`,
    }
  }

  if (step === 'dishRelated') {
    const dishes = list(context.dishes.map((target) => target.dish), lang, es ? 'ni' : 'or')
    const relatedIds = [...new Set(context.dishes.flatMap((target) => [...target.related.tags, ...target.related.categories]))]
    const present = relatedIds.filter((id) => rows.some((row) => row.tags.includes(id) || row.categories.includes(id)))
    const neighborhoods = context.after.interpretation.must.neighborhoods
    const where = neighborhoods.length ? ` ${es ? 'en' : 'in'} ${neighborhoodNames(neighborhoods, lang)}` : ''
    const labels = list(present.map((id) => relatedLabel(id, lang).toLowerCase()), lang, es ? 'o' : 'or')
    return {
      what: step,
      message: es
        ? `No encontramos ${dishes}${where}${labels ? `; estos tienen ${labels}` : ''}.`
        : `We couldn't find ${dishes}${where}${labels ? `; these have ${labels}` : ''}.`,
    }
  }

  // Un solo aviso por la ampliación del radio, del radio inicial al último que se usó.
  if (step === 'radiusMax') return null
  if (step === 'radius') {
    const previous = context.before.nearRadius
    if (previous === null || !rows.some((row) => row.distance !== null && row.distance > previous)) return null
    const [from, to] = [distanceText(previous, lang), distanceText(context.after.nearRadius ?? RADII[RADII.length - 1], lang)]
    return {
      what: step,
      message: es ? `No encontramos lugares a menos de ${from}: te mostramos hasta ${to}.` : `Nothing within ${from}: showing places up to ${to} away.`,
    }
  }

  if (step === 'neighborhood') {
    const wanted = value.must.neighborhoods
    if (!rows.some((row) => !wanted.includes(row.neighborhoodId))) return null
    const names = neighborhoodNames(wanted, lang)
    return {
      what: step,
      message: es
        ? `Ningún lugar en ${names} cumple todo lo que pediste: te mostramos lugares cercanos.`
        : `Nothing in ${names} matches everything you asked for: showing places nearby.`,
    }
  }

  if (step === 'openAt') {
    const moment = context.moment
    if (!moment || !rows.some((row) => openStatus(row.hours, moment).state === 'closed')) return null
    return { what: step, message: es ? 'No hay lugares abiertos en ese horario: te mostramos todos.' : 'Nothing open at that time: showing all places.' }
  }

  return {
    what: step,
    message: es ? 'No encontramos lugares que cumplan todo: te mostramos los más parecidos.' : "We couldn't find places matching everything: showing the closest matches.",
  }
}

const DIET_WORDS: Record<Lang, Record<DietKey, string>> = {
  es: { vegan: 'veganas', vegetarian: 'vegetarianas', glutenFree: 'sin TACC' },
  en: { vegan: 'vegan', vegetarian: 'vegetarian', glutenFree: 'gluten-free' },
}

/** Aviso cuando ni el último recurso encuentra nada: nombra la dieta y/o los exclude que bloquean. */
export function noMatchNotice(value: Interpretation, blocking: { diet: boolean; exclude: boolean }) {
  const lang = value.language
  const es = lang === 'es'
  const diet = blocking.diet ? DIET_KEYS.filter((key) => value.must.diet[key]).map((key) => DIET_WORDS[lang][key]) : []
  const excluded = blocking.exclude ? [...value.exclude.categories, ...value.exclude.tags].map((id) => excludedTerm(id, lang)) : []
  const withDiet = diet.length ? (es ? ` con opciones ${list(diet, lang)} confirmadas` : ` with confirmed ${list(diet, lang)} options`) : ''
  const except = excluded.length ? `${diet.length ? ',' : ''} ${es ? 'excepto' : 'except'} ${list(excluded, lang)}` : ''
  const message = withDiet || except
    ? es ? `No encontramos lugares${withDiet}${except}.` : `We couldn't find places${withDiet}${except}.`
    : es ? 'Todavía no hay lugares publicados.' : 'There are no published places yet.'
  return { what: 'noMatch' as const, message }
}
