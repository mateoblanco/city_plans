import type { BenefitCap, CapCurrency, CapPeriod, CardType, DiscountBenefit, BenefitMode, Weekday } from '@shared/discounts.ts'
import type { BenefitRow } from './queries'
import { byProviderOrder, providerName } from './selection'

/** Un beneficio en la ficha: el formato común, sin lo que la app no muestra (fechas, texto fuente, parser). */
export type PlaceBenefit = Pick<
  DiscountBenefit,
  'id' | 'percent' | 'cardType' | 'cardTiers' | 'cardProgram' | 'days' | 'daysText' | 'mode' | 'instantPercent' | 'refundPercent' | 'cap' | 'conditions' | 'sourceUrl'
>

/** Un bloque de la ficha: un proveedor con sus beneficios. */
export type PlaceDiscountProvider = { id: string; name: string; benefits: PlaceBenefit[] }

const CARD_ORDER: Record<CardType, number> = { debit: 0, credit: 1, other: 2 }

function toBenefit(row: BenefitRow): PlaceBenefit {
  const cap: BenefitCap | null = row.capText
    ? { text: row.capText, amount: row.capAmount, currency: row.capCurrency as CapCurrency | null, period: row.capPeriod as CapPeriod | null }
    : null
  return {
    id: row.id,
    percent: Number(row.percent),
    cardType: row.cardType as CardType,
    cardTiers: row.cardTiers ?? [],
    cardProgram: row.cardProgram,
    days: row.daysKind === 'all' ? 'all' : row.daysKind === 'list' ? (row.days as Weekday[]) : null,
    daysText: row.daysText,
    mode: row.mode as BenefitMode,
    instantPercent: row.instantPercent === null ? null : Number(row.instantPercent),
    refundPercent: row.refundPercent === null ? null : Number(row.refundPercent),
    cap,
    conditions: row.conditions,
    sourceUrl: row.sourceUrl,
  }
}

/**
 * Los beneficios agrupados por proveedor, en el orden de la config. Dentro de cada uno: débito, crédito y otra; a igual
 * tipo, sin nivel primero y después por porcentaje.
 */
export function groupBenefits(rows: BenefitRow[]): PlaceDiscountProvider[] {
  const byProvider = new Map<string, PlaceBenefit[]>()
  for (const row of rows) byProvider.set(row.providerId, [...(byProvider.get(row.providerId) ?? []), toBenefit(row)])
  const groups = [...byProvider].map(([id, benefits]) => ({
    id,
    name: providerName(id),
    benefits: benefits.sort(
      (a, b) =>
        CARD_ORDER[a.cardType] - CARD_ORDER[b.cardType] ||
        Number(a.cardTiers.length > 0) - Number(b.cardTiers.length > 0) ||
        a.percent - b.percent ||
        a.id.localeCompare(b.id),
    ),
  }))
  return byProviderOrder(groups, (group) => group.id)
}
