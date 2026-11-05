import { idsCookieValue, parseIdsCookie } from "./place-list-cookie";

/**
 * Cookie espejo de los guardados (la escribe utils/saved.ts desde localStorage): sólo ids, el más reciente primero. La
 * lee la home para renderizar "Guardados" en el servidor; la búsqueda y el perfil de gustos no la usan.
 */
export const SAVED_COOKIE = "saved";
export const MAX_SAVED = 100;

/** Los guardados de la cookie, del más reciente al más viejo. */
export const parseSavedCookie = (raw: string | null | undefined): string[] => parseIdsCookie(raw, MAX_SAVED);

/** Valor de la cookie: los 100 más recientes. */
export const savedCookieValue = (ids: string[]) => idsCookieValue(ids, MAX_SAVED);
