import { DISCOUNT_PROVIDERS } from "@shared/discounts.ts";
import { DISCOUNT_CARDS, type DiscountCard } from "./discount-cards";

/**
 * "Mis tarjetas": las tarjetas que la persona dice tener (bienvenida de la home o el último filtro de Descuentos
 * aplicado). Se guardan en localStorage y en una cookie espejo para que el servidor arme las filas "Descuentos con
 * <Banco>" de la home en ese pedido (el servidor no guarda nada). Cada una es `proveedor.tipo` (`itau.credit`), la
 * misma clave que el filtro (`f=discount:itau.credit`, sin el `discount:`). Sin hooks ni zod: lo importan el cliente,
 * server components y rutas.
 */
export const MY_CARDS_KEY = "cityPlans.cards";
export const MY_CARDS_COOKIE = "cards";

/** Como mucho una por proveedor y tipo. */
export const MAX_MY_CARDS = DISCOUNT_PROVIDERS.length * DISCOUNT_CARDS.length;

const SEPARATOR = ",";
const PROVIDER_IDS = new Set<string>(DISCOUNT_PROVIDERS.map((provider) => provider.id));

export type MyCard = { provider: string; card: DiscountCard };

/** `itau.credit` → tarjeta; null si el proveedor o el tipo no están en el catálogo. */
export function parseCardKey(raw: string): MyCard | null {
  const index = raw.lastIndexOf(".");
  if (index <= 0) return null;
  const provider = raw.slice(0, index);
  const card = raw.slice(index + 1);
  if (!PROVIDER_IDS.has(provider) || !(DISCOUNT_CARDS as readonly string[]).includes(card)) return null;
  return { provider, card: card as DiscountCard };
}

/** Claves válidas del catálogo, sin repetidas, en el orden en que vienen, hasta MAX_MY_CARDS. */
export function parseMyCardKeys(values: unknown[]): string[] {
  const keys = values.filter((value): value is string => typeof value === "string" && parseCardKey(value) !== null);
  return [...new Set(keys)].slice(0, MAX_MY_CARDS);
}

/** Las tarjetas de la cookie (lo que lee el servidor en cada pedido). Acepta el valor codificado o ya decodificado. */
export function parseMyCardsCookie(raw: string | null | undefined): string[] {
  if (!raw) return [];
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // Un % suelto: se lee tal cual (y lo inválido se descarta).
  }
  return parseMyCardKeys(value.split(SEPARATOR));
}

/** Valor de la cookie (codificado: la coma no va cruda en una cookie). */
export const myCardsCookieValue = (keys: string[]) => encodeURIComponent(parseMyCardKeys(keys).join(SEPARATOR));
