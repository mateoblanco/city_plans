import type { DiscountProviderId } from '@shared/discounts.ts'

// Descuentos en la app: los datos los llena el backoffice (tablas discount_*); acá sólo el orden y los textos.
export const DISCOUNTS_CONFIG = {
  /** Orden fijo de los proveedores en el filtro, la card y la ficha. Uno que no está acá va al final. */
  order: ['brou', 'itau', 'santander', 'bbva', 'scotiabank', 'itau-personal-bank'] as DiscountProviderId[],
  /** Lugares por grupo cuando se agrupa por proveedor (2 o más elegidos); el resto, en "Ver todos". */
  groupMax: 6,
  groupTitle: (name: string) => `Con descuento ${name}`,
}
