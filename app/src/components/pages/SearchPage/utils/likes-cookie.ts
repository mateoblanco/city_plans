import { idsCookieValue, parseIds, parseIdsCookie } from "./place-list-cookie";

/**
 * Cookie espejo de los likes (los escribe utils/likes.ts desde localStorage): la lee la búsqueda del servidor en cada
 * pedido, sin guardarla. Sin hooks: la importan server components y la ruta de /api/search.
 */
export const LIKES_COOKIE = "likes";
/**
 * Tope de likes (localStorage y cookie). Es el mismo número que SEARCH_CONFIG.personal.maxLikes: va acá porque lo importa
 * el cliente (sin código de server/), y un test exige que coincidan.
 */
export const MAX_LIKES = 100;

/** Ids válidos (formato uuid), sin repetidos, como mucho los 100 primeros (los más recientes). */
export const parseLikes = (values: unknown[]): string[] => parseIds(values, MAX_LIKES);

/** Los likes de la cookie (lo que lee el servidor en cada búsqueda). */
export const parseLikesCookie = (raw: string | null | undefined): string[] => parseIdsCookie(raw, MAX_LIKES);

/** Valor de la cookie: los 100 más recientes. */
export const likesCookieValue = (ids: string[]) => idsCookieValue(ids, MAX_LIKES);
