import { iconFamily } from '../../src/data/icon-categories.ts'

// Cortes de precio por tipo de lugar, en pesos uruguayos: por debajo de low es low, por encima de high es high y en el
// medio, moderate. Los usan la extracción (deterministicPrice, precio por persona) y `yarn prices:suggest` (mediana de
// la carta). Panaderías, heladerías, comida rápida y el resto usan los de restaurante.
export type PriceKind = 'restaurant' | 'bar' | 'cafe'
export type PriceTier = 'low' | 'moderate' | 'high'

export const PRICE_CUTS: Record<PriceKind, { low: number; high: number }> = {
  restaurant: { low: 600, high: 1500 },
  bar: { low: 500, high: 1300 },
  cafe: { low: 350, high: 800 },
}

export const PRICE_KIND_LABELS: Record<PriceKind, string> = { restaurant: 'restaurante', bar: 'bar', cafe: 'café' }

const BAR_CATEGORIES = ['bar', 'brewery', 'wine_bar']

const RESTAURANT_CATEGORIES = ['restaurant', 'pizzeria']

/**
 * El tipo para los cortes: restaurante si las categorías lo dicen (un café que sirve platos se compara con
 * restaurantes); si no, la familia del ícono y, sin familia, las demás categorías.
 */
export function priceKindOf(iconCategory: string | null | undefined, categories: readonly string[]): PriceKind {
  if (categories.some((category) => RESTAURANT_CATEGORIES.includes(category))) return 'restaurant'
  const family = iconFamily(iconCategory)
  if (family === 'coffee' || family === 'breakfast') return 'cafe'
  if (family === 'wine_cocktails' || family === 'beer') return 'bar'
  if (family) return 'restaurant'
  if (categories.includes('cafe')) return 'cafe'
  if (categories.some((category) => BAR_CATEGORIES.includes(category))) return 'bar'
  return 'restaurant'
}

export function tierFor(kind: PriceKind, value: number): PriceTier {
  const cuts = PRICE_CUTS[kind]
  if (value < cuts.low) return 'low'
  if (value > cuts.high) return 'high'
  return 'moderate'
}
