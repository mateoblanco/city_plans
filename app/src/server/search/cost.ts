import type { ProviderMetadata } from 'ai'

/** Una llamada paga de la búsqueda (modelo o embedding) y lo que cobró el AI Gateway en dólares. */
export type CostEntry = {
  step: 'interpret' | 'embed'
  model: string
  /** null si el Gateway no informó costo o la llamada falló. */
  usd: number | null
  /** Vino de la cache de Next: esta búsqueda no pagó nada. */
  cached: boolean
}

export type SearchCost = { totalUsd: number; calls: CostEntry[] }

/** Costo que informa el AI Gateway en providerMetadata.gateway.cost (string en USD). */
export function gatewayCost(metadata: ProviderMetadata | undefined): number | null {
  const value = Number(metadata?.gateway?.cost)
  return metadata?.gateway?.cost !== undefined && Number.isFinite(value) ? value : null
}

/** "US$ 0,000305", "US$ 0,00000004": cifras significativas, porque una llamada cuesta fracciones de centavo. */
export function formatUsd(value: number): string {
  return `US$ ${value.toLocaleString('es-UY', { maximumSignificantDigits: 3, maximumFractionDigits: 10 })}`
}

export function summarizeCost(calls: CostEntry[]): SearchCost {
  return { totalUsd: calls.reduce((sum, call) => sum + (call.cached ? 0 : call.usd ?? 0), 0), calls }
}
