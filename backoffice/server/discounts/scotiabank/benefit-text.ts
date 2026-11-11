import type { CardType } from '../../../src/types/discounts.ts'
import { cleanText, fold } from '../text.ts'

export type ScotiaCard = { cardType: CardType; cardTiers: string[] }
export type ScotiaLine = { percent: number; cards: ScotiaCard[] }

// Niveles de crédito de Scotiabank que aparecen en la fuente (sin la palabra "crédito" también son crédito, como en
// Santander). "Premium" es el nivel de débito: no se toma como crédito.
const CREDIT_TIERS: Record<string, string> = {
  platinum: 'Platinum', infinite: 'Infinite', gold: 'Gold', oro: 'Oro', black: 'Black', signature: 'Signature',
  internacional: 'Internacional', clasica: 'Clásica', clasicas: 'Clásica',
}
const DEBIT_TIERS: Record<string, string> = { premium: 'Premium', clasica: 'Clásica', clasicas: 'Clásica' }
// Un nivel que vale para los dos tipos ("crédito y débito Clásicas"). "Premium" no: en "crédito y débito Premium" no se
// sabe qué créditos son (las bases dicen Platinum, Infinite y Gold).
const SHARED_TIERS: Record<string, string> = { clasica: 'Clásica', clasicas: 'Clásica' }

/** Los porcentajes de un texto ("25% y 15% de ahorro" → [25, 15]). */
export const percentsIn = (text: string) => [...text.matchAll(/(\d{1,3})\s*%/g)].map((match) => Number(match[1])).filter((value) => value > 0 && value <= 100)

/** "con Tarjetas de Crédito Platinum, Infinite, Gold y Débito Premium." → "credito platinum infinite gold y debito premium". */
function cardWords(texto: string): string {
  return fold(cleanText(texto.replace(/\*\*/g, '')))
    .replace(/[.,;:/]+/g, ' ')
    .replace(/\b(con|tus?|las?|tarjetas?|de|scotiabank|uruguay)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tierList(words: string, table: Record<string, string>): string[] | null {
  const parts = words.split(/\s+y\s+|\s+/).filter(Boolean)
  const tiers = parts.map((part) => table[part])
  return tiers.every(Boolean) ? [...new Set(tiers)] : null
}

/**
 * Tarjetas de un texto de Scotiabank, con reglas. null si no se lee con confianza (va al modelo). Nunca un débito que el
 * texto no dice.
 */
export function parseScotiaCards(texto: string): ScotiaCard[] | null {
  const words = cardWords(texto)
  if (!words) return null
  // "crédito y débito" / "débito y crédito", con un nivel compartido opcional ("Clásicas").
  const both = /^(?:credito y debito|debito y credito)(?: (\S+))?$/.exec(words)
  if (both) {
    if (!both[1]) return [{ cardType: 'credit', cardTiers: [] }, { cardType: 'debit', cardTiers: [] }]
    const shared = SHARED_TIERS[both[1]]
    return shared ? [{ cardType: 'credit', cardTiers: [shared] }, { cardType: 'debit', cardTiers: [shared] }] : null
  }
  if (words === 'credito') return [{ cardType: 'credit', cardTiers: [] }]
  if (words === 'debito') return [{ cardType: 'debit', cardTiers: [] }]
  // "[crédito] Platinum Infinite Gold [y débito Premium]".
  const split = /^(?:credito )?(.+?)(?: y debito (.+))?$/.exec(words)
  if (!split) return null
  const credit = tierList(split[1], CREDIT_TIERS)
  if (!credit) return null
  const cards: ScotiaCard[] = [{ cardType: 'credit', cardTiers: credit }]
  if (split[2]) {
    const debit = tierList(split[2], DEBIT_TIERS)
    if (!debit) return null
    cards.push({ cardType: 'debit', cardTiers: debit })
  }
  return cards
}

/** Una línea de `descuentos` con reglas: un solo porcentaje y tarjetas legibles. null si no (al modelo). */
export function parseScotiaLine(pct: string, texto: string): ScotiaLine | null {
  const percents = percentsIn(pct).length ? percentsIn(pct) : percentsIn(texto)
  if (percents.length !== 1) return null
  const cards = parseScotiaCards(texto)
  return cards ? { percent: percents[0], cards } : null
}

/**
 * Una frase de las bases con varios porcentajes, en una cláusula por porcentaje: "Todos los días 25% de descuento con
 * tarjetas … Débito Premium y 15% de descuento con tarjetas de crédito y débito Scotiabank." → dos líneas.
 */
export function percentClauses(sentence: string): { pct: string; texto: string }[] {
  return cleanText(sentence)
    .split(/\s+y\s+(?=\d{1,3}\s*%)/)
    .flatMap((clause) => {
      const match = /(\d{1,3}\s*%(?:\s+de\s+(?:descuento|ahorro))?)\s*(.*)$/i.exec(clause)
      return match ? [{ pct: match[1], texto: match[2] }] : []
    })
}
