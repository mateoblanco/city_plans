import { z } from "zod";

/**
 * Cookies espejo de las listas de lugares del navegador (likes, guardados): sólo ids en orden, el más reciente primero,
 * separados por punto (100 × 37 caracteres entran en los 4 KB). Sin hooks: las importan server components y rutas.
 */
const SEPARATOR = ".";

// guid: cualquier uuid con formato válido (z.uuid exige versión y variante RFC).
const uuid = z.guid();

/** Ids válidos (formato uuid), sin repetidos, como mucho los max primeros (los más recientes). */
export function parseIds(values: unknown[], max: number): string[] {
  const ids = values.filter((value): value is string => typeof value === "string" && uuid.safeParse(value).success);
  return [...new Set(ids)].slice(0, max);
}

/** Los ids de una cookie (lo que lee el servidor en cada pedido). */
export const parseIdsCookie = (raw: string | null | undefined, max: number): string[] => parseIds((raw ?? "").split(SEPARATOR), max);

/** Valor de la cookie: los max más recientes. */
export const idsCookieValue = (ids: string[], max: number) => parseIds(ids, max).join(SEPARATOR);
