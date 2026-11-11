import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BenefitStructurer, StructuredBenefit } from '../structure-benefits.ts'
import { discountProviders } from '../providers.ts'

export const SCOTIABANK = discountProviders().find((provider) => provider.id === 'scotiabank')!
export const PAGE = SCOTIABANK.sourceUrl
/** Corrida de los fixtures: 11 de noviembre de 2026, mediodía en Montevideo. */
export const NOW = () => new Date('2026-11-11T15:00:00Z')

/**
 * HTML real de Scotiabank (11/11/2026), completo: los datos están en los scripts. `beneficios`: el pedido normal;
 * `beneficios-rendered`: el DOM después de cargar en Chromium (Playwright), con el legal de las cards visibles en base64.
 */
export const fixture = (name: 'beneficios' | 'beneficios-rendered') => readFileSync(join(import.meta.dirname, '__fixtures__', `${name}.html`), 'utf8')

/** Las respuestas de Haiku grabadas en la corrida en seco (por texto), para los dos casos que van al modelo. */
const recorded = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', 'haiku.json'), 'utf8')) as Record<string, StructuredBenefit[]>

export function recordedStructurer(calls: string[] = []): BenefitStructurer {
  return async (text) => {
    calls.push(text)
    const benefits = recorded[text]
    if (!benefits) throw new Error(`Sin respuesta grabada para «${text}».`)
    return { benefits, costUsd: 0.0004, cached: false }
  }
}
