import type { DiscountProvider } from '../../src/types/discounts.ts'

/**
 * Proveedores configurados. Cada uno tiene su lector en readers.ts; todos devuelven el formato común
 * (src/types/discounts.ts). Itaú Personal Bank, cuando se sume, va como otra entrada, separada de Itaú.
 */
export const DISCOUNT_PROVIDERS = [
  {
    id: 'bbva',
    name: 'BBVA',
    kind: 'bank',
    sourceUrl: 'https://www.bbva.com.uy/personas/productos/tarjetas/descuentos/gastronomia.html',
  },
  {
    id: 'santander',
    name: 'Santander',
    kind: 'bank',
    // Los filtros van en el GET (no hace falta viewsreference ni Playwright). page=0, 1, … de 8 cards cada una.
    sourceUrl: 'https://www.santander.com.uy/beneficios',
    listing: {
      // 49 = Montevideo; 22 = Ruta Gourmet (las heladerías, 289, quedan afuera por ahora).
      params: { 'departamento[0]': '49', categoria: '22' },
      maxPages: 30,
    },
  },
] as const satisfies readonly DiscountProvider[]

export type DiscountProviderId = (typeof DISCOUNT_PROVIDERS)[number]['id']

export function discountProvider(id: string): DiscountProvider | undefined {
  return DISCOUNT_PROVIDERS.find((provider) => provider.id === id)
}
