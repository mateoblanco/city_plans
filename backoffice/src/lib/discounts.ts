import type { BenefitCap, BenefitDays, BenefitMode, CapPeriod, CardType, DiscountBenefit, DiscountPlace, MatchOrigin, MatchStatus, StoredBenefit, Weekday } from '@/types/discounts'
import { CARD_TYPES } from '@/types/discounts'

export const CARD_TYPE_LABELS: Record<CardType, string> = { debit: 'Débito', credit: 'Crédito', other: 'Otra / sin especificar' }
export const MATCH_LABELS: Record<MatchStatus, string> = { found: 'Encontrado', doubtful: 'Dudoso', missing: 'No está en la base', not_matched: 'Fuera de Montevideo' }
export const MODE_LABELS: Record<BenefitMode, string> = { instant: 'En el momento', refund: 'Reintegro', mixed: 'Mixto', unknown: 'No se sabe' }
export const ORIGIN_LABELS: Record<MatchOrigin, string> = { auto: 'Auto', manual: 'Manual' }
const PERIOD_LABELS: Record<CapPeriod, string> = { statement: 'por cierre', month: 'por mes', week: 'por semana', day: 'por día', purchase: 'por compra' }
const DAY_LABELS: Record<Weekday, string> = { mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom' }

const percent = (value: number) => `${String(value).replace('.', ',')}%`

/** "Débito 20% · Crédito 20–30%"; las tarjetas co-branded van aparte ("Crédito Nacional 20–30%"). */
export function benefitSummary(benefits: DiscountBenefit[]): string {
  const groups = new Map<string, { type: CardType; label: string; values: number[] }>()
  for (const type of CARD_TYPES) {
    for (const benefit of benefits.filter((item) => item.cardType === type)) {
      const label = benefit.cardProgram ? `${CARD_TYPE_LABELS[type]} ${benefit.cardProgram}` : CARD_TYPE_LABELS[type]
      const group = groups.get(label) ?? { type, label, values: [] }
      group.values.push(benefit.percent)
      groups.set(label, group)
    }
  }
  return [...groups.values()].map(({ label, values }) => {
    const min = Math.min(...values)
    const max = Math.max(...values)
    return `${label} ${min === max ? percent(min) : `${String(min).replace('.', ',')}–${percent(max)}`}`
  }).join(' · ')
}

export function daysLabel(days: BenefitDays): string {
  if (days === 'all') return 'Todos los días'
  if (days === null) return 'No se pudo determinar'
  return days.map((day) => DAY_LABELS[day]).join(', ')
}

export function modeLabel(benefit: Pick<DiscountBenefit, 'mode' | 'instantPercent' | 'refundPercent'>): string {
  if (benefit.mode === 'mixed') return `Mixto: ${percent(benefit.instantPercent ?? 0)} en el momento + ${percent(benefit.refundPercent ?? 0)} de reintegro`
  return MODE_LABELS[benefit.mode]
}

/** "1 nov 2026 – 31 oct 2027", "hasta 31 oct 2027" o "—". */
export function validityLabel(validFrom: string | null, validTo: string | null): string {
  const format = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  if (validFrom && validTo) return `${format(validFrom)} – ${format(validTo)}`
  if (validTo) return `hasta ${format(validTo)}`
  if (validFrom) return `desde ${format(validFrom)}`
  return '—'
}

/** "4.000 UYU por cierre"; "Sin tope"; si no se pudo leer, el texto original. */
export function capLabel(cap: BenefitCap | null): string {
  if (!cap) return '—'
  if (cap.amount === null) return cap.text
  return [cap.amount.toLocaleString('es-UY'), cap.currency, cap.period ? PERIOD_LABELS[cap.period] : null].filter(Boolean).join(' ')
}

/** Beneficio vigente: apareció en la última lectura y no venció. */
export const isBenefitCurrent = (benefit: StoredBenefit) => benefit.active && !benefit.expired

/** Lugar vigente: apareció en la última corrida y tiene algún beneficio vigente. */
export const isPlaceCurrent = (place: DiscountPlace) => place.active && place.benefits.some(isBenefitCurrent)

/** Vigencia del lugar: la de la campaña o, si no, el rango de sus beneficios. */
export function placeValidity(place: Pick<DiscountPlace, 'campaign' | 'benefits'>): string {
  const from = place.campaign.validFrom ?? place.benefits.map((benefit) => benefit.validFrom).filter((value): value is string => Boolean(value)).sort()[0] ?? null
  const to = place.campaign.validTo ?? place.benefits.map((benefit) => benefit.validTo).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
  return validityLabel(from, to)
}

export type CityFilter = 'montevideo' | 'outside' | 'all'

export type DiscountFilters = {
  providerId: string
  match: MatchStatus | ''
  origin: MatchOrigin | ''
  city: CityFilter
  cardType: CardType | ''
  /** Por defecto se ocultan los inactivos (no aparecieron o sin beneficios vigentes) y los ignorados. */
  showInactive: boolean
  showIgnored: boolean
}

export const DEFAULT_DISCOUNT_FILTERS: DiscountFilters = { providerId: '', match: '', origin: '', city: 'montevideo', cardType: '', showInactive: false, showIgnored: false }

export function filterDiscountPlaces(places: DiscountPlace[], filters: DiscountFilters): DiscountPlace[] {
  return places.filter((place) =>
    (filters.showInactive || isPlaceCurrent(place))
    && (filters.showIgnored || !place.ignored)
    && (!filters.providerId || place.providerId === filters.providerId)
    && (!filters.match || place.match.status === filters.match)
    && (!filters.origin || place.match.origin === filters.origin)
    && (filters.city === 'all' || (filters.city === 'montevideo' ? place.montevideo : !place.montevideo))
    && (!filters.cardType || place.benefits.some((benefit) => benefit.cardType === filters.cardType)))
}

export type DiscountSummary = {
  places: number
  benefits: number
  matches: Record<MatchStatus, number>
  manual: number
  /** En todo lo guardado, sin filtros: vigentes y no ignorados en Montevideo y fuera, inactivos e ignorados. */
  total: { montevideo: number; outside: number; inactive: number; ignored: number }
}

/** El resumen de lo que muestra la tabla (`shown`, ya filtrado), así los números cierran con ella; más totales de `all`. */
export function discountSummary(shown: DiscountPlace[], all: DiscountPlace[]): DiscountSummary {
  const matches: Record<MatchStatus, number> = { found: 0, doubtful: 0, missing: 0, not_matched: 0 }
  for (const place of shown) matches[place.match.status] += 1
  const visible = all.filter((place) => isPlaceCurrent(place) && !place.ignored)
  return {
    places: shown.length,
    benefits: shown.reduce((total, place) => total + place.benefits.filter(isBenefitCurrent).length, 0),
    matches,
    manual: shown.filter((place) => place.match.origin === 'manual').length,
    total: {
      montevideo: visible.filter((place) => place.montevideo).length,
      outside: visible.filter((place) => !place.montevideo).length,
      inactive: all.filter((place) => !isPlaceCurrent(place)).length,
      ignored: all.filter((place) => place.ignored).length,
    },
  }
}
