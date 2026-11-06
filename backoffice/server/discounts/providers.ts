import { DISCOUNT_PROVIDERS, type DiscountProvider } from '../../src/types/discounts.ts'

/**
 * Los proveedores configurados viven en /shared/discounts.ts (la app los usa para los nombres y el filtro). Cada uno
 * tiene su lector en readers.ts.
 */
export { DISCOUNT_PROVIDERS, type DiscountProviderId } from '../../src/types/discounts.ts'

export function discountProvider(id: string): DiscountProvider | undefined {
  return DISCOUNT_PROVIDERS.find((provider) => provider.id === id)
}
