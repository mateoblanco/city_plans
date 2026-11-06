import type { BenefitDays, CardType } from '../../../src/types/discounts.ts'
import { cleanText, fold, parseDays } from '../text.ts'

/** Un beneficio leído con reglas del texto libre de Santander. */
export type SantanderRuleBenefit = {
  percent: number
  cardType: CardType
  cardTiers: string[]
  days: BenefitDays
  daysText: string | null
  /** La oración de donde salió. */
  sourceText: string
}

export type SantanderBenefitText = {
  benefits: SantanderRuleBenefit[]
  /** Oraciones con un porcentaje que las reglas no leen con confianza: van al modelo. */
  pending: string[]
  /** Oraciones que no son un porcentaje de descuento ("devolución de puntos de IVA", "canje de puntos"): no se guardan. */
  ignored: string[]
  /** Menciona canje de puntos Soy Santander. */
  points: boolean
}

// Niveles y segmentos que conozco, con el nombre que se guarda. Las claves van sin tildes y en minúscula.
const TIERS: Record<string, string> = {
  'private banking': 'Private Banking',
  platinum: 'Platinum',
  select: 'Select',
  infinite: 'Infinite',
  black: 'Black',
  gold: 'Gold',
  oro: 'Oro',
  internacional: 'Internacional',
  internacionales: 'Internacional',
  classic: 'Classic',
  signature: 'Signature',
}
// Niveles que sólo existen como tarjeta de crédito: sin la palabra "crédito", igual son crédito.
const CREDIT_ONLY = new Set(['Platinum', 'Infinite', 'Black', 'Gold', 'Oro', 'Internacional', 'Classic', 'Signature'])
// Palabras que no cambian el sentido.
const FILLER = new Set(['con', 'tarjeta', 'tarjetas', 'de', 'del', 'la', 'las', 'el', 'los', 'en', 'descuento', 'descuentos', 'off', 'sus', 'todas', 'todo', 'santander', 'pagando', 'abonando', 'clientes'])

const PERCENT = /(\d{1,3}(?:[.,]\d+)?)\s*%/g
const ALL_DAYS = /\btodos los dias\b/
// Los días se leen aparte (parseDays sobre la oración): acá sólo se sacan para leer las tarjetas.
const DAY = '(?:lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)'
const DAY_PHRASES = new RegExp(`\\b(?:(?:de|los|el)\\s+)?${DAY}(?:\\s+(?:a|al|y|e)\\s+${DAY})*\\b|\\bfines? de semana\\b`, 'g')

type Entry = { types: CardType[]; tiers: string[] }

/** Lee un tramo "con Infinite, Black y débito Select". null si queda alguna palabra que no conozco. */
function parseCards(rest: string): Entry[] | null {
  // Sin la conjunción que une con el porcentaje siguiente ("… select y 15% …").
  const folded = fold(fold(rest).replace(ALL_DAYS, ' ').replace(DAY_PHRASES, ' ').replace(/[.;:()]/g, ' ')).replace(/(?:^|\s)(?:y|e|o|,)$/, '').replace(/^(?:y|e|o)\s/, '')
  const tokens = folded.split(/\s*,\s*|\s+y\s+|\s+e\s+|\s+o\s+/).map((token) => token.trim()).filter(Boolean)
  const entries: Entry[] = []
  for (const token of tokens) {
    let words = token.split(/\s+/).filter((word) => !FILLER.has(word))
    const entry: Entry = { types: [], tiers: [] }
    // "private banking" son dos palabras.
    const joined = words.join(' ')
    if (joined.includes('private banking')) {
      entry.tiers.push(TIERS['private banking'])
      words = joined.replace('private banking', ' ').split(/\s+/).filter(Boolean)
    }
    for (const word of words) {
      if (word === 'credito') entry.types.push('credit')
      else if (word === 'debito') entry.types.push('debit')
      else if (TIERS[word]) entry.tiers.push(TIERS[word])
      else return null
    }
    if (entry.types.length || entry.tiers.length) entries.push(entry)
  }
  return entries
}

/** Agrupa: los que dicen el tipo van con él; los demás niveles, a crédito si alguno es sólo de crédito, o a "otra". */
function benefitsOf(entries: Entry[]): { cardType: CardType; cardTiers: string[] }[] {
  const byType = new Map<CardType, string[]>()
  const add = (type: CardType, tiers: string[]) => byType.set(type, [...new Set([...(byType.get(type) ?? []), ...tiers])])
  const untyped: string[] = []
  for (const entry of entries) {
    if (entry.types.length) for (const type of entry.types) add(type, entry.tiers)
    else untyped.push(...entry.tiers)
  }
  if (untyped.length) add(untyped.some((tier) => CREDIT_ONLY.has(tier)) ? 'credit' : 'other', untyped)
  // Sin tipo ni nivel ("15% de descuento todos los días"): sin especificar. Nunca se inventa un débito.
  if (byType.size === 0) add('other', [])
  return [...byType].map(([cardType, cardTiers]) => ({ cardType, cardTiers }))
}

/**
 * El texto libre del beneficio de Santander, con reglas: una oración por línea, y cada oración partida en cada
 * porcentaje ("50% con Infinite… , 30% de crédito y débito"). Lo que no se puede leer con confianza queda en
 * `pending` para el modelo; lo que no es un porcentaje de descuento, en `ignored`.
 */
export function parseSantanderBenefitText(text: string): SantanderBenefitText {
  const result: SantanderBenefitText = { benefits: [], pending: [], ignored: [], points: false }
  const sentences = text.split(/\n+|(?<=\.)\s+(?=[A-ZÁÉÍÓÚ0-9])/).map(cleanText).filter(Boolean)
  for (const sentence of sentences) {
    const folded = fold(sentence)
    if (/canje de puntos/.test(folded)) result.points = true
    const matches = [...sentence.matchAll(PERCENT)]
    if (matches.length === 0) {
      result.ignored.push(sentence)
      continue
    }
    const days = ALL_DAYS.test(folded) ? { days: 'all' as const, daysText: sentence.match(/todos los d[ií]as/i)?.[0] ?? null } : parseDays(sentence)
    const parsed: SantanderRuleBenefit[] = []
    let unreadable = days.days === null
    for (const [index, match] of matches.entries()) {
      const end = matches[index + 1]?.index ?? sentence.length
      const percent = Number(match[1].replace(',', '.'))
      const rest = sentence.slice(match.index + match[0].length, end)
      const entries = parseCards(rest)
      if (!entries || !(percent > 0 && percent <= 100)) {
        unreadable = true
        break
      }
      for (const benefit of benefitsOf(entries)) parsed.push({ percent, ...benefit, days: days.days, daysText: days.daysText, sourceText: sentence })
    }
    if (unreadable) result.pending.push(sentence)
    else result.benefits.push(...parsed)
  }
  return result
}

/** El modelo no puede inventar un débito: sólo si la oración dice "débito". */
export const mentionsDebit = (text: string) => /\bdebito\b/.test(fold(text))
