import type { BenefitCap, BenefitDays, CapCurrency, CapPeriod, Weekday } from '../../src/types/discounts.ts'
import { WEEKDAYS } from '../../src/types/discounts.ts'

/** Minúscula, sin tildes, espacios simples. */
export const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export const cleanText = (value: string) => value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}
const MONTH_NAMES = Object.keys(MONTHS).join('|')
// "31de mayo" (sin espacio) también aparece en los legales.
// "30 de setiembre del 2026" también.
const DATE = `(\\d{1,2})\\s*de\\s+(${MONTH_NAMES})(?:\\s+del?)?\\s+(\\d{4})`

function isoDate(day: string, month: string, year: string): string | null {
  const d = Number(day)
  const m = MONTHS[month]
  const y = Number(year)
  if (!m || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Fechas en español del texto, en orden ("1 de noviembre de 2026", "31 de Octubre 2027"). */
export function spanishDates(text: string): string[] {
  const dates: string[] = []
  for (const match of fold(text).matchAll(new RegExp(DATE, 'g'))) {
    const date = isoDate(match[1], match[2], match[3])
    if (date) dates.push(date)
  }
  return dates
}

/** "válida del X al Y", "desde el X al Y", "desde el X hasta el Y". */
export function validityRange(text: string): { validFrom: string | null; validTo: string | null } | null {
  const match = new RegExp(`(?:del|desde el|desde)\\s+${DATE}\\s+(?:al|hasta el|hasta)\\s+${DATE}`).exec(fold(text))
  if (!match) return null
  return { validFrom: isoDate(match[1], match[2], match[3]), validTo: isoDate(match[4], match[5], match[6]) }
}

// ── Días ──

const DAY_WORDS: Record<string, Weekday> = {
  lunes: 'mon', martes: 'tue', miercoles: 'wed', jueves: 'thu', viernes: 'fri', sabado: 'sat', sabados: 'sat', domingo: 'sun', domingos: 'sun',
}
const DAY_PATTERN = Object.keys(DAY_WORDS).sort((a, b) => b.length - a.length).join('|')
const DAY_MENTION = new RegExp(`\\b(${DAY_PATTERN}|fines? de semana|todos los dias|feriados?)\\b`)

function dayRange(from: Weekday, to: Weekday): Weekday[] {
  const start = WEEKDAYS.indexOf(from)
  const end = WEEKDAYS.indexOf(to)
  const days: Weekday[] = []
  for (let index = start; ; index = (index + 1) % 7) {
    days.push(WEEKDAYS[index])
    if (index === end) break
  }
  return days
}

/**
 * Días de un beneficio. Sin mención de días: 'all' (no hay restricción). "Todos los días": 'all'. "De lunes a jueves",
 * "martes y miércoles", "fines de semana": la lista. Una mención que no se puede leer con confianza (exclusiones,
 * feriados, días mezclados con horarios): null, con el texto para revisarlo.
 */
export function parseDays(text: string): { days: BenefitDays; daysText: string | null } {
  const sentences = cleanText(text).split(/(?<=[.;])\s+/)
  const mentions = sentences.filter((sentence) => DAY_MENTION.test(fold(sentence)))
  if (mentions.length === 0) return { days: 'all', daysText: null }
  const daysText = mentions.join(' ')
  const folded = fold(daysText)
  if (mentions.length > 1 || /\b(excepto|salvo|menos|no valid|feriado)/.test(folded)) return { days: null, daysText }
  if (/\btodos los dias\b/.test(folded)) return { days: 'all', daysText }
  const found = new Set<Weekday>()
  if (/\bfines? de semana\b/.test(folded)) {
    found.add('sat')
    found.add('sun')
  }
  for (const match of folded.matchAll(new RegExp(`\\bde (${DAY_PATTERN}) a (${DAY_PATTERN})\\b`, 'g'))) {
    for (const day of dayRange(DAY_WORDS[match[1]], DAY_WORDS[match[2]])) found.add(day)
  }
  for (const match of folded.matchAll(new RegExp(`\\b(${DAY_PATTERN})\\b`, 'g'))) found.add(DAY_WORDS[match[1]])
  if (found.size === 0) return { days: null, daysText }
  return { days: WEEKDAYS.filter((day) => found.has(day)), daysText }
}

// ── Tope ──

/**
 * "4000 pesos uruguayos por cierre de estado de cuenta" → 4000 · UYU · statement. Lo que no se lee queda en null; el
 * texto se guarda siempre. "Sin tope": todo null.
 */
export function parseCap(text: string | null): BenefitCap | null {
  if (!text) return null
  const clean = cleanText(text)
  const folded = fold(clean)
  if (/^sin tope/.test(folded)) return { text: clean, amount: null, currency: null, period: null }
  // "4000", "4.000", "$U 4.000", "1500,50".
  const number = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/.exec(folded)
  const amount = number ? Number(`${number[1].replace(/\./g, '')}${number[2] ? `.${number[2]}` : ''}`) : null
  const currency: CapCurrency | null = /u\$s|usd|dolar/.test(folded) ? 'USD' : /pesos|\$u|uyu|\$/.test(folded) ? 'UYU' : null
  const period: CapPeriod | null = /cierre|estado de cuenta/.test(folded) ? 'statement'
    : /por mes|mensual/.test(folded) ? 'month'
    : /por semana|semanal/.test(folded) ? 'week'
    : /por dia|diario/.test(folded) ? 'day'
    : /por (?:compra|transaccion|factura|ticket)/.test(folded) ? 'purchase'
    : null
  return { text: clean, amount, currency, period }
}

/** "01/12/2026" → 2026-12-01 (día/mes/año, como se escribe en Uruguay). */
export function numericDate(text: string): string | null {
  const match = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text)
  if (!match) return null
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Vigencia de un texto de bases: "del X al Y"; si no, "hasta el X" / "vigente hasta el 01/12/2026" / "válido hasta…"
 * (sólo fin). null si no dice nada.
 */
export function validityOf(text: string): { validFrom: string | null; validTo: string | null } | null {
  const range = validityRange(text)
  if (range) return range
  const folded = fold(text)
  const until = /hasta el\s+(.{0,40})/.exec(folded)
  if (!until) return null
  const validTo = spanishDates(until[1])[0] ?? numericDate(until[1])
  return validTo ? { validFrom: null, validTo } : null
}
