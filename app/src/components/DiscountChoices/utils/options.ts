import { availableCards, type DiscountCard } from "@/lib/discount-cards";

export const CARD_LABELS: Record<DiscountCard, string> = { debit: "Débito", credit: "Crédito" };

/** Un proveedor del panel con los tipos de tarjeta de sus beneficios (con "other", que cuenta como los dos). */
export type DiscountProvider = { id: string; name: string; cardTypes: string[] };

export type DiscountOption = { key: string; provider: DiscountProvider; card: DiscountCard };

/**
 * Las filas del panel (un proveedor, sus chips) y las opciones en ese orden. Un tipo sin beneficios no tiene chip,
 * salvo que esté en keep (lo elegido en la URL: así se puede sacar).
 */
export function discountRows(providers: DiscountProvider[], keep: string[] = []) {
  const kept = (provider: DiscountProvider) =>
    keep.flatMap((key) => (key.startsWith(`${provider.id}.`) ? [key.slice(provider.id.length + 1) as DiscountCard] : []));
  const rows = providers.map((provider) => ({ provider, cards: availableCards(provider.cardTypes, kept(provider)) }));
  const options: DiscountOption[] = rows.flatMap(({ provider, cards }) => cards.map((card) => ({ key: `${provider.id}.${card}`, provider, card })));
  return { rows, options };
}

/** Las claves elegidas en el orden de las opciones (no en el de la URL ni en el de los clics). */
export const inOptionOrder = (options: DiscountOption[], keys: string[]) => options.map((option) => option.key).filter((key) => keys.includes(key));
