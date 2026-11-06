import type { BenefitDays, CardType } from '../../../src/types/discounts.ts'
import { fold, parseDays } from '../text.ts'

export type ItauRuleBenefit = { cardType: CardType; cardTiers: string[]; days: BenefitDays; daysText: string | null }

// Niveles de tarjeta que nombran las páginas. "Personal Bank" no es un nivel: es el segmento (otro proveedor).
const TIERS: [RegExp, string][] = [
  [/\bplatinum\b/, 'Platinum'],
  [/\binfinite\b/, 'Infinite'],
  [/\bblack\b/, 'Black'],
  [/\bgold\b/, 'Gold'],
]

/**
 * Los beneficios de una sección por su texto ("Todos los días, con tarjetas de crédito Itaú de Uruguay."):
 * - "crédito" y/o "débito": esos tipos (nunca un débito que el texto no diga);
 * - un nivel junto a "tarjetas de crédito …" (Platinum) va en ese crédito;
 * - "Incluye Infinite y Black": además, crédito con esos niveles.
 * null si el texto no dice el tipo de tarjeta: va al modelo.
 */
export function parseItauSectionText(text: string): ItauRuleBenefit[] | null {
  const folded = fold(text)
  const days = /\btodos los dias\b/.test(folded) ? { days: 'all' as const, daysText: text.match(/todos los d[ií]as/i)?.[0] ?? null } : parseDays(text)
  const credit = /\bcredito\b/.test(folded)
  const debit = /\bdebito\b/.test(folded)
  if (!credit && !debit) return null
  // "Incluye Infinite y Black": niveles que se suman, no los de la tarjeta principal.
  // (puede repetirse: la nota al pie de la sección también lo dice).
  const includes = [...folded.matchAll(/\bincluye\s+([^.]+)/g)].map((match) => match[1]).join(' ')
  const main = folded.replace(/\bincluye\s+[^.]+/g, '')
  const tiersIn = (value: string) => TIERS.filter(([pattern]) => pattern.test(value)).map(([, name]) => name)
  const mainTiers = tiersIn(main)
  const benefits: ItauRuleBenefit[] = []
  if (debit) benefits.push({ cardType: 'debit', cardTiers: [], ...days })
  if (credit) benefits.push({ cardType: 'credit', cardTiers: mainTiers, ...days })
  const extra = tiersIn(includes).filter((tier) => !mainTiers.includes(tier))
  if (extra.length) benefits.push({ cardType: 'credit', cardTiers: extra, ...days })
  return benefits
}
