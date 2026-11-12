import { idsCookieValue, parseIdsCookie } from "./place-list-cookie";

/**
 * Cookie espejo de los guardados (la escribe utils/saved.ts desde localStorage): sólo ids, el más reciente primero. Es la
 * única cookie de lugares que lee el servidor: la home ("Guardados" y "Para vos") y la búsqueda (readParams, /api/search),
 * en cada pedido y sin guardarla. Sin hooks: la importan server components y rutas.
 */
export const SAVED_COOKIE = "saved";
/**
 * Tope de guardados (localStorage y cookie). Es el mismo número que SEARCH_CONFIG.personal.maxLikes: va acá porque lo
 * importa el cliente (sin código de server/), y un test exige que coincidan.
 */
export const MAX_SAVED = 100;

/** Los guardados de la cookie, del más reciente al más viejo (ids validados, sin repetidos). */
export const parseSavedCookie = (raw: string | null | undefined): string[] => parseIdsCookie(raw, MAX_SAVED);

/** Valor de la cookie: los 100 más recientes. */
export const savedCookieValue = (ids: string[]) => idsCookieValue(ids, MAX_SAVED);
