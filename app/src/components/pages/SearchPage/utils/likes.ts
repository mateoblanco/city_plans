import { SEARCH_CONFIG } from "@/server/search/config";
import { LIKES_COOKIE } from "./likes-cookie";
import { createPlaceList } from "./place-list";

/**
 * Likes de las cards: sólo ids de lugares, en localStorage (más reciente primero). Cada cambio escribe también una
 * cookie espejo con los 100 más recientes (36 caracteres por id: entra en los 4 KB) para que la búsqueda del servidor
 * los lea en ese pedido; el servidor no guarda nada. Si localStorage falla, la app sigue sin likes. Alimentan el perfil
 * de gustos ("Para vos"); los guardados (utils/saved.ts) no.
 */
export const LIKES_KEY = "cityPlans.likes";

const likes = createPlaceList({ storageKey: LIKES_KEY, cookieName: LIKES_COOKIE, max: SEARCH_CONFIG.personal.maxLikes, dated: false });

/** null: localStorage no está disponible (o falla); la app sigue sin likes. */
export const readLikes = likes.read;

/** Guarda o saca el lugar (el que se agrega va primero). false si no se pudo guardar. */
export const toggleLike = (id: string, storage?: Parameters<typeof likes.toggle>[1]) => likes.toggle(id, storage);

/** Borra todos los likes (localStorage y cookie). */
export const clearLikes = likes.clear;

/** Likes actuales; available false si localStorage no funciona (no se muestra el corazón). */
export function useLikes(): { available: boolean; ids: string[] } {
  const { available, ids } = likes.useList();
  return { available, ids };
}
