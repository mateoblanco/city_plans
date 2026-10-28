import { canonicalOf } from './dishes'
import { SEARCH_CONFIG } from './config'
import { detectIntent } from './intents'
import type { Interpretation, Lang } from './interpretation'

/**
 * Horario escrito en el texto, resuelto sin el modelo: hoy / esta noche, un día, una franja ("a la tarde") y "tarde"
 * con bares ("tomar algo tarde": de noche, tirando a madrugada). Lo escrito manda sobre lo que diga el modelo.
 */
type Slot = keyof typeof SEARCH_CONFIG.slots
type Part = { kind: 'today' | 'tonight' | 'late' } | { kind: 'day'; day: number } | { kind: 'slot'; slot: Slot }

const today = { kind: 'today' } as const
const tonight = { kind: 'tonight' } as const
const day = (value: number) => ({ kind: 'day', day: value }) as const
const slot = (value: Slot) => ({ kind: 'slot', slot: value }) as const

// "Abre hoy": abierto ahora o abre más tarde hoy ("esta noche": a la noche). "tarde" suelta sólo es trasnoche con bares.
export const WHEN_PHRASES = new Map<string, [Part, Lang]>([
  ...['abierto ahora', 'abiertos ahora', 'abierto', 'abiertos', 'ahora', 'hoy', 'abre hoy', 'abierto hoy', 'abiertos hoy'].map((phrase) => [phrase, [today, 'es']] as const),
  ...['open now', 'open', 'today', 'open today'].map((phrase) => [phrase, [today, 'en']] as const),
  ['esta noche', [tonight, 'es']], ['hoy a la noche', [tonight, 'es']], ['hoy de noche', [tonight, 'es']], ['tonight', [tonight, 'en']],
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
  'manana', 'tomorrow', 'mediodia', 'noon', 'tardecita', 'now',
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
  if (!late && !slotPart && named === undefined && !has('today') && !has('tonight')) return unchanged

  const next: Interpretation = structuredClone(value)
  if (outAtNight && intent === null) next.intent ??= 'bars'
  if (late && !next.prefer.tags.includes('late_night') && !next.must.tags.includes('late_night')) next.prefer.tags.push('late_night')
  const previous = typeof value.must.openAt === 'object' ? value.must.openAt : null
  const time = late ? SEARCH_CONFIG.night.late : slotPart ? SEARCH_CONFIG.slots[slotPart] : null
  const onToday = has('today') || has('tonight')
  if (named !== undefined) next.must.openAt = { day: named, time: time ?? (onToday ? null : previous?.time ?? null) }
  else if (time) next.must.openAt = { day: onToday ? null : previous?.day ?? null, time }
  // Sin día ni hora concreta: "hoy" y "esta noche" como siempre.
  else if (onToday) next.must.openAt = has('tonight') ? 'tonight' : 'today'
  return { interpretation: next, late, out: outAtNight }
}

export const applyWhen = (value: Interpretation, normalized: string) => readWhen(value, normalized).interpretation
