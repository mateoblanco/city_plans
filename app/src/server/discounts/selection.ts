import { DISCOUNT_PROVIDERS, type CardType, type DiscountProviderId } from '@shared/discounts.ts'
import { DISCOUNTS_CONFIG } from './config'

/** Tipos de tarjeta que se eligen en el filtro. Un beneficio "other" (sin especificar) cumple los dos. */
export const DISCOUNT_CARDS = ['debit', 'credit'] as const
export type DiscountCard = (typeof DISCOUNT_CARDS)[number]

/** Una elección del filtro: `f=discount:itau.credit`. No distingue niveles de tarjeta (Platinum, Black…). */
export type DiscountChoice = { provider: DiscountProviderId; card: DiscountCard }

/** Lo que tiene un lugar: un par proveedor y tipo de tarjeta por cada beneficio que cuenta (sin repetir). */
export type PlaceDiscount = { provider: string; cardType: CardType }

const PROVIDER_IDS = new Set<string>(DISCOUNT_PROVIDERS.map((provider) => provider.id))

export const isDiscountProvider = (id: string): id is DiscountProviderId => PROVIDER_IDS.has(id)

/**
 * Los chips del panel para un proveedor: los tipos con algún beneficio ("other" cuenta como los dos) y, aunque ya no
 * tengan, los elegidos en la URL (para poder sacarlos). En el orden de DISCOUNT_CARDS.
 */
export function availableCards(cardTypes: string[], chosen: DiscountCard[] = []): DiscountCard[] {
  return DISCOUNT_CARDS.filter((card) => chosen.includes(card) || cardTypes.includes(card) || cardTypes.includes('other'))
}

/** El id de una elección en `f` (sin el `discount:`). */
export const choiceKey = (choice: DiscountChoice) => `${choice.provider}.${choice.card}`

/** `itau.credit` → elección; null si el proveedor o el tipo no están en el catálogo. */
export function parseChoice(raw: string): DiscountChoice | null {
  const index = raw.lastIndexOf('.')
  if (index <= 0) return null
  const provider = raw.slice(0, index)
  const card = raw.slice(index + 1)
  if (!isDiscountProvider(provider) || !(DISCOUNT_CARDS as readonly string[]).includes(card)) return null
  return { provider, card: card as DiscountCard }
}

export const matchesChoice = (discount: PlaceDiscount, choice: DiscountChoice) =>
  discount.provider === choice.provider && (discount.cardType === choice.card || discount.cardType === 'other')

/** Posición del proveedor en el orden fijo de la config (los que no están, al final). */
export function providerRank(id: string): number {
  const index = DISCOUNTS_CONFIG.order.indexOf(id as DiscountProviderId)
  return index === -1 ? DISCOUNTS_CONFIG.order.length : index
}

export const byProviderOrder = <T>(items: T[], idOf: (item: T) => string) =>
  [...items].sort((a, b) => providerRank(idOf(a)) - providerRank(idOf(b)))

export function providerName(id: string): string {
  return DISCOUNT_PROVIDERS.find((provider) => provider.id === id)?.name ?? id
}

/** Los proveedores elegidos, sin repetir y en el orden de la config. */
export function selectedProviders(choices: DiscountChoice[]): DiscountProviderId[] {
  return byProviderOrder([...new Set(choices.map((choice) => choice.provider))], (id) => id)
}

/**
 * Los proveedores que muestra la card (los chips de "Descuento"), con id y nombre, en el orden de la config. Sin filtro, todos los del
 * lugar; con el filtro, sólo los que cumplen alguna elección.
 */
export function cardProviders(discounts: PlaceDiscount[], choices: DiscountChoice[]): { id: string; name: string }[] {
  const ids = new Set(
    discounts
      .filter((discount) => choices.length === 0 || choices.some((choice) => matchesChoice(discount, choice)))
      .map((discount) => discount.provider),
  )
  return byProviderOrder([...ids], (id) => id).map((id) => ({ id, name: providerName(id) }))
}
