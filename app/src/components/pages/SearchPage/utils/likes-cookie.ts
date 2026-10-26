import { z } from "zod";
import { SEARCH_CONFIG } from "@/server/search/config";

/**
 * Cookie espejo de los likes (los escribe utils/likes.ts desde localStorage): la lee la búsqueda del servidor en cada
 * pedido, sin guardarla. Sin hooks: la importan server components y la ruta de /api/search.
 */
export const LIKES_COOKIE = "likes";
const SEPARATOR = ".";
const MAX_LIKES = SEARCH_CONFIG.personal.maxLikes;

// guid: cualquier uuid con formato válido (z.uuid exige versión y variante RFC).
const uuid = z.guid();

/** Ids válidos (formato uuid), sin repetidos, como mucho los 100 primeros (los más recientes). */
export function parseLikes(values: unknown[]): string[] {
  const ids = values.filter((value): value is string => typeof value === "string" && uuid.safeParse(value).success);
  return [...new Set(ids)].slice(0, MAX_LIKES);
}

/** Los likes de la cookie (lo que lee el servidor en cada búsqueda). */
export const parseLikesCookie = (raw: string | null | undefined): string[] => parseLikes((raw ?? "").split(SEPARATOR));

/** Valor de la cookie: los 100 más recientes. */
export const likesCookieValue = (ids: string[]) => parseLikes(ids).join(SEPARATOR);
