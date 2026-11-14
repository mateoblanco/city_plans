import { canonicalOf } from './dishes'
import { SEARCH_CONFIG } from './config'
import { detectIntent } from './intents'
import type { Interpretation, Lang } from './interpretation'

/**
 * Horario escrito en el texto, resuelto sin el modelo: abierto ahora, hoy, esta noche, hoy al mediodía, un día, una
 * franja ("a la tarde") y "tarde" con bares ("tomar algo tarde": de noche, tirando a madrugada). Lo escrito manda sobre
 * lo que diga el modelo.
 */
type Slot = keyof typeof SEARCH_CONFIG.slots
type Part = { kind: 'now' | 'today' | 'tonight' | 'midday' | 'late' } | { kind: 'day'; day: number } | { kind: 'slot'; slot: Slot }

const now = { kind: 'now' } as const
const today = { kind: 'today' } as const
const tonight = { kind: 'tonight' } as const
const midday = { kind: 'midday' } as const
const day = (value: number) => ({ kind: 'day', day: value }) as const
const slot = (value: Slot) => ({ kind: 'slot', slot: value }) as const

// "Abierto ahora" (abierto, abre hoy); "hoy" solo es abierto ahora o abre más tarde hoy (con cena, esta noche; con
// almuerzo, hoy al mediodía); "esta noche"; "mediodía". "tarde" suelta sólo es trasnoche con bares.
export const WHEN_PHRASES = new Map<string, [Part, Lang]>([
  ...['abierto ahora', 'abiertos ahora', 'abierta ahora', 'abiertas ahora', 'abierto', 'abiertos', 'abierta', 'abiertas', 'ahora', 'abre hoy', 'abren hoy', 'abierto hoy', 'abiertos hoy', 'abierta hoy', 'abiertas hoy', 'que abra hoy', 'que abran hoy', 'ya abierto', 'abierto ya']
    .map((phrase) => [phrase, [now, 'es']] as const),
  ...['open now', 'open', 'open today', 'opens today', 'right now'].map((phrase) => [phrase, [now, 'en']] as const),
  ['hoy', [today, 'es']], ['today', [today, 'en']],
  ...['esta noche', 'hoy a la noche', 'hoy de noche', 'hoy en la noche', 'hoy por la noche'].map((phrase) => [phrase, [tonight, 'es']] as const),
  ['tonight', [tonight, 'en']],
  ...['mediodia', 'al mediodia', 'a mediodia', 'hoy al mediodia', 'hoy a mediodia', 'este mediodia'].map((phrase) => [phrase, [midday, 'es']] as const),
  ...['midday', 'at midday', 'noon', 'at noon', 'lunchtime'].map((phrase) => [phrase, [midday, 'en']] as const),
  ...['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].map((name, index) => [name, [day(index), 'es']] as const),
  ...['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((name, index) => [name, [day(index), 'en']] as const),
  ...['a la tarde', 'por la tarde', 'de tarde', 'esta tarde', 'la tarde', 'a la tardecita', 'de tardecita'].map((phrase) => [phrase, [slot('afternoon'), 'es']] as const),
  ...['in the afternoon', 'this afternoon', 'afternoon'].map((phrase) => [phrase, [slot('afternoon'), 'en']] as const),
  ...['a la noche', 'de noche', 'por la noche', 'la noche', 'noche'].map((phrase) => [phrase, [slot('night'), 'es']] as const),
  ...['at night', 'in the evening', 'evening', 'night'].map((phrase) => [phrase, [slot('night'), 'en']] as const),
  ['tarde', [{ kind: 'late' }, 'es']], ['late', [{ kind: 'late' }, 'en']],
] as [string, [Part, Lang]][])

/**
 * Palabras de horario: ya hicieron su trabajo en openAt, así que no van como keyword ni a la búsqueda por nombre
 * (casi todos los lugares tienen "noche" o "martes" en el texto).
 */
export const TIME_WORDS = new Set([
  ...[...WHEN_PHRASES.keys()].flatMap((phrase) => phrase.split(' ')),
  'manana', 'tomorrow', 'tardecita', 'now',
])

// "salir" sin otra intención es salir de noche: con "tarde" o una noche, son bares.
const OUT_WORDS = new Set(['salir', 'go out', 'going out'])

// Lo bastante largo para saltear una frase del catálogo entera, como el diccionario.
const MAX_WORDS = 5

/** Las partes de horario del texto, frase más larga primero. Las frases del catálogo ("abierto hasta tarde") se saltean. */
function parse(normalized: string): { parts: Part[]; out: boolean } {
  const words = normalized.split(' ').filter(Boolean)
  const parts: Part[] = []
  let out = false
  for (let index = 0; index < words.length; ) {
    let consumed = 1
    for (let length = Math.min(MAX_WORDS, words.length - index); length >= 1; length--) {
      const phrase = words.slice(index, index + length).join(' ')
      const found = WHEN_PHRASES.get(phrase)
      if (found) parts.push(found[0])
      else if (OUT_WORDS.has(phrase)) out = true
      else if (!(length > 1 && canonicalOf(phrase))) continue
      consumed = length
      break
    }
    index += consumed
  }
  return { parts, out }
}

/** late / out: si "tarde" y "salir" se usaron (con bares o de noche); si no, el diccionario no los da por reconocidos. */
export type WhenResult = { interpretation: Interpretation; late: boolean; out: boolean }

/** El horario del texto sobre la interpretación: day = el día nombrado, si no hoy, si no el que traía; time = trasnoche, si no la franja, si no el que traía. */
export function readWhen(value: Interpretation, normalized: string): WhenResult {
  const { parts, out } = parse(normalized)
  const unchanged = { interpretation: value, late: false, out: false }
  if (!parts.length) return unchanged
  const has = (kind: Part['kind']) => parts.some((part) => part.kind === kind)
  const named = parts.find((part) => part.kind === 'day')?.day
  const slotPart = parts.find((part) => part.kind === 'slot')?.slot
  const intent = detectIntent(value)
  // "salir tarde", "salir de noche": bares, si nada más eligió otra intención.
  const outAtNight = out && (intent === null || intent === 'bars') && (has('late') || has('tonight') || slotPart === 'night')
  const late = has('late') && (intent === 'bars' || outAtNight)
  const onToday = has('now') || has('today') || has('tonight') || has('midday')
  if (!late && !slotPart && named === undefined && !onToday) return unchanged

  const next: Interpretation = structuredClone(value)
  if (outAtNight && intent === null) next.intent ??= 'bars'
  if (late && !next.prefer.tags.includes('late_night') && !next.must.tags.includes('late_night')) next.prefer.tags.push('late_night')
  const previous = typeof value.must.openAt === 'object' ? value.must.openAt : null
  const time = late ? SEARCH_CONFIG.night.late : slotPart ? SEARCH_CONFIG.slots[slotPart] : null
  if (named !== undefined) next.must.openAt = { day: named, time: time ?? (onToday ? null : previous?.time ?? null) }
  else if (time) next.must.openAt = { day: onToday ? null : previous?.day ?? null, time }
  // Sin día ni hora concreta: la ventana más precisa gana ("abierto esta noche" es esta noche; "hoy abierto", ahora).
  else if (onToday) next.must.openAt = has('tonight') ? 'tonight' : has('midday') ? 'midday' : has('now') ? 'now' : mealToday(next)
  return { interpretation: next, late, out: outAtNight }
}

export const applyWhen = (value: Interpretation, normalized: string) => readWhen(value, normalized).interpretation

/** "hoy" sin más: con cena es esta noche ("cenar hoy"), con almuerzo es hoy al mediodía ("almorzar hoy"); si no, hoy. */
function mealToday(value: Interpretation): 'today' | 'tonight' | 'midday' {
  const tags = [...value.must.tags, ...value.prefer.tags]
  if (tags.includes('dinner')) return 'tonight'
  if (tags.includes('lunch')) return 'midday'
  return 'today'
}
