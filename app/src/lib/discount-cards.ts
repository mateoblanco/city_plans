/** Tipos de tarjeta que se eligen en el filtro. Un beneficio "other" (sin especificar) cumple los dos. */
export const DISCOUNT_CARDS = ['debit', 'credit'] as const
export type DiscountCard = (typeof DISCOUNT_CARDS)[number]

/**
 * Los chips del panel para un proveedor: los tipos con algún beneficio ("other" cuenta como los dos) y, aunque ya no
 * tengan, los elegidos en la URL (para poder sacarlos). En el orden de DISCOUNT_CARDS.
 */
export function availableCards(cardTypes: string[], chosen: DiscountCard[] = []): DiscountCard[] {
  return DISCOUNT_CARDS.filter((card) => chosen.includes(card) || cardTypes.includes(card) || cardTypes.includes('other'))
}
