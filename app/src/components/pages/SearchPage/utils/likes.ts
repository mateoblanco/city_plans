import { useSyncExternalStore } from "react";
import { SEARCH_CONFIG } from "@/server/search/config";
import { LIKES_COOKIE, likesCookieValue, parseLikes } from "./likes-cookie";

/**
 * Likes de las cards: sólo ids de lugares, en localStorage (más reciente primero). Cada cambio escribe también una
 * cookie espejo con los 100 más recientes (36 caracteres por id: entra en los 4 KB) para que la búsqueda del servidor
 * los lea en ese pedido; el servidor no guarda nada. Si localStorage falla, la app sigue sin likes.
 */
export const LIKES_KEY = "cityPlans.likes";
const MAX_LIKES = SEARCH_CONFIG.personal.maxLikes;
const ONE_YEAR = 60 * 60 * 24 * 365;

type LikesStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): LikesStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** null: localStorage no está disponible (o falla); la app sigue sin likes. */
export function readLikes(storage: LikesStorage | null = browserStorage()): string[] | null {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LIKES_KEY) ?? "[]");
    return Array.isArray(parsed) ? parseLikes(parsed) : [];
  } catch {
    return null;
  }
}

function writeCookie(ids: string[]) {
  try {
    if (typeof document === "undefined") return;
    const value = likesCookieValue(ids);
    document.cookie = value
      ? `${LIKES_COOKIE}=${value}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
      : `${LIKES_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Sin cookie, la búsqueda sigue sin perfil.
  }
}

function readCookie(): string | null {
  try {
    if (typeof document === "undefined") return null;
    const entry = document.cookie.split("; ").find((part) => part.startsWith(`${LIKES_COOKIE}=`));
    return entry ? entry.slice(LIKES_COOKIE.length + 1) : "";
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function writeLikes(ids: string[], storage: LikesStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.setItem(LIKES_KEY, JSON.stringify(ids));
  } catch {
    return false;
  }
  writeCookie(ids);
  notify();
  return true;
}

/** Guarda o saca el lugar (el que se agrega va primero). false si no se pudo guardar. */
export function toggleLike(id: string, storage: LikesStorage | null = browserStorage()): boolean {
  const current = readLikes(storage);
  if (current === null) return false;
  const next = current.includes(id) ? current.filter((other) => other !== id) : [id, ...current];
  return writeLikes(next.slice(0, MAX_LIKES), storage);
}

/** Borra todos los likes (localStorage y cookie). */
export function clearLikes(storage: LikesStorage | null = browserStorage()) {
  try {
    storage?.removeItem(LIKES_KEY);
  } catch {
    // Igual se borra la cookie.
  }
  writeCookie([]);
  notify();
}

/** La cookie sigue a localStorage: si venció o quedó distinta, se reescribe (una vez por carga). */
let synced = false;
function syncCookie() {
  if (synced) return;
  synced = true;
  const ids = readLikes();
  if (ids !== null && readCookie() !== likesCookieValue(ids)) writeCookie(ids);
}

function subscribe(listener: () => void) {
  syncCookie();
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LIKES_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

// Un string estable como snapshot: "" = localStorage no disponible.
const UNAVAILABLE = "";
const snapshot = () => {
  const ids = readLikes();
  return ids === null ? UNAVAILABLE : JSON.stringify(ids);
};
const serverSnapshot = () => "[]";

/** Likes actuales; available false si localStorage no funciona (no se muestra el corazón). */
export function useLikes(): { available: boolean; ids: string[] } {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return raw === UNAVAILABLE ? { available: false, ids: [] } : { available: true, ids: JSON.parse(raw) as string[] };
}
