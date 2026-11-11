import { createHash } from 'node:crypto'
import type { CardType, DiscountBenefit, DiscountRunError, ProviderPlace } from '../../src/types/discounts.ts'
import type { DiscountProvider } from './providers.ts'
import type { PageFetcher } from './polite-fetch.ts'
import type { BenefitStructurer } from './structure-benefits.ts'
import type { Geocoder } from './geocode.ts'
import type { RowSplitter } from './brou/split-rows.ts'

/** Un lugar leído, todavía sin cruzar con la base. */
export type ReadPlace = ProviderPlace

export type ReaderProgress = { phase: 'listing' | 'details'; done: number; total: number | null }

export type ReaderContext = {
  provider: DiscountProvider
  fetcher: PageFetcher
  /** Para el texto libre que no se puede leer con reglas. Sin él, esos beneficios quedan como error parcial. */
  structure?: BenefitStructurer
  /** Separa nombre, dirección y ciudad de las filas de un listado en PDF (BROU). Sin él, ese listado es un error. */
  splitRows?: RowSplitter
  /** Coordenadas de las direcciones que la fuente da sin ellas (BROU). Sin él, los locales quedan sin coordenadas. */
  geocoder?: Geocoder
  onProgress?: (progress: ReaderProgress) => void
}

export type ReaderResult = {
  places: ReadPlace[]
  /** Lugares cuyo detalle no se pudo leer: sus beneficios guardados no se marcan inactivos ("no pude leer" ≠ "desapareció"). */
  unread: string[]
  /** Errores parciales (un detalle que no se pudo leer). Un error de estructura del listado se lanza. */
  errors: DiscountRunError[]
  warnings: string[]
  /** Datos de la corrida que no son problemas (cuántos por reglas o por el modelo, lo omitido a propósito). */
  notes?: string[]
  llm: { calls: number; costUsd: number }
}

export type ProviderReader = (context: ReaderContext) => Promise<ReaderResult>

export const stableId = (...parts: (string | number)[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)

/** Sin el porcentaje: si la fuente lo cambia, se actualiza el mismo beneficio. */
export function benefitId(placeId: string, cardType: CardType, cardTiers: string[], cardProgram: string | null = null) {
  return stableId(placeId, cardType, [...cardTiers].map((tier) => tier.toLowerCase()).sort().join(','), cardProgram ?? '')
}

/** Dos beneficios con el mismo id (mismo tipo, niveles y programa con otro porcentaje): el segundo con "#2", y así. */
export function dedupeBenefitIds(benefits: DiscountBenefit[]): DiscountBenefit[] {
  const seen = new Map<string, number>()
  return benefits.map((benefit) => {
    const count = (seen.get(benefit.id) ?? 0) + 1
    seen.set(benefit.id, count)
    return count === 1 ? benefit : { ...benefit, id: `${benefit.id}#${count}` }
  })
}

/** Slug estable de la URL del detalle ("…/gastronomia/La_Vuelta.html" → "la_vuelta"). */
export function sourceSlug(url: string): string {
  const last = new URL(url).pathname.split('/').pop() ?? url
  return last.replace(/\.html?$/i, '').toLowerCase()
}

