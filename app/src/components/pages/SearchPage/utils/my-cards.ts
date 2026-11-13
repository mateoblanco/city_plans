import { useSyncExternalStore } from "react";
import { MY_CARDS_COOKIE, MY_CARDS_KEY, myCardsCookieValue, parseMyCardKeys } from "@/lib/my-cards";
import type { PlaceListStorage } from "./place-list";

/**
 * "Mis tarjetas" en el navegador (src/lib/my-cards.ts): las claves `proveedor.tipo` en localStorage y la cookie espejo
 * para el servidor (filas "Descuentos con <Banco>" de la home). Las escriben la bienvenida de la home y el filtro de
 * Descuentos al aplicarse; el panel las muestra premarcadas sin aplicarlas. Si localStorage falla, no hay tarjetas.
 */
const ONE_YEAR = 60 * 60 * 24 * 365;

function browserStorage(): PlaceListStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(storage: PlaceListStorage | null): string | null {
  try {
    return storage?.getItem(MY_CARDS_KEY) ?? null;
  } catch {
    return null;
  }
}

function parseRaw(raw: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parseMyCardKeys(parsed) : [];
  } catch {
    return [];
  }
}

/** Las tarjetas guardadas (claves válidas del catálogo). Vacío si no hay o si localStorage no funciona. */
export const readMyCards = (storage: PlaceListStorage | null = browserStorage()): string[] => parseRaw(readRaw(storage));

function writeCookie(keys: string[]) {
  try {
    if (typeof document === "undefined") return;
    const value = myCardsCookieValue(keys);
    document.cookie = value
      ? `${MY_CARDS_COOKIE}=${value}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
      : `${MY_CARDS_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    // Sin cookie, el servidor sigue sin las tarjetas.
  }
}

function readCookie(): string | null {
  try {
    if (typeof document === "undefined") return null;
    const entry = document.cookie.split("; ").find((part) => part.startsWith(`${MY_CARDS_COOKIE}=`));
    return entry ? entry.slice(MY_CARDS_COOKIE.length + 1) : "";
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Reemplaza las tarjetas (localStorage y cookie). false si localStorage no funciona. */
export function setMyCards(keys: string[], storage: PlaceListStorage | null = browserStorage()): boolean {
  if (!storage) return false;
  const valid = parseMyCardKeys(keys);
  try {
    storage.setItem(MY_CARDS_KEY, JSON.stringify(valid));
  } catch {
    return false;
  }
  writeCookie(valid);
  notify();
  return true;
}

/** La cookie sigue a localStorage: si venció o quedó distinta, se reescribe (una vez por carga). */
let synced = false;
function syncCookie() {
  if (synced) return;
  synced = true;
  const keys = readMyCards();
  if (readCookie() !== myCardsCookieValue(keys)) writeCookie(keys);
}

const onStorage = (event: StorageEvent) => {
  if (event.key === MY_CARDS_KEY) notify();
};

function subscribe(listener: () => void) {
  syncCookie();
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

// Snapshot estable: el JSON de las claves válidas (no el texto crudo, que puede traer basura).
const snapshot = () => JSON.stringify(readMyCards());
const serverSnapshot = () => "[]";

/** Las tarjetas actuales; en el servidor y al hidratar, ninguna. */
export function useMyCards(): string[] {
  return JSON.parse(useSyncExternalStore(subscribe, snapshot, serverSnapshot)) as string[];
}
