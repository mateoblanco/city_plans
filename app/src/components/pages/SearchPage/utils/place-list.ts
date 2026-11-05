import { useSyncExternalStore } from "react";
import { idsCookieValue, parseIds } from "./place-list-cookie";

/**
 * Una lista de lugares del navegador (likes, guardados): ids en localStorage, el más reciente primero, con una cookie
 * espejo de los max más recientes para que el servidor la lea en ese pedido (el servidor no guarda nada). Con dated,
 * cada entrada lleva también la fecha en que se agregó (sólo en localStorage: con fechas la cookie no entra en 4 KB).
 * Si localStorage falla, la app sigue sin la lista.
 */
export type PlaceListStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PlaceListEntry = { id: string; savedAt: string };
export type PlaceListState = { available: boolean; ids: string[]; entries: PlaceListEntry[] };

type Options = { storageKey: string; cookieName: string; max: number; dated: boolean };

const ONE_YEAR = 60 * 60 * 24 * 365;

function browserStorage(): PlaceListStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isEntry = (value: unknown): value is PlaceListEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PlaceListEntry).id === "string" &&
  typeof (value as PlaceListEntry).savedAt === "string" &&
  !Number.isNaN(Date.parse((value as PlaceListEntry).savedAt));

/** Entradas con fecha válidas: id uuid y fecha legible, sin repetidos (queda la primera, la más reciente), hasta max. */
function parseEntries(values: unknown[], max: number): PlaceListEntry[] {
  const seen = new Set<string>();
  const entries: PlaceListEntry[] = [];
  for (const value of values) {
    if (!isEntry(value) || seen.has(value.id) || parseIds([value.id], 1).length === 0) continue;
    seen.add(value.id);
    entries.push({ id: value.id, savedAt: value.savedAt });
  }
  return entries.slice(0, max);
}

export function createPlaceList({ storageKey, cookieName, max, dated }: Options) {
  /** null: localStorage no está disponible (o falla). Sin dated, savedAt queda vacío. */
  function readEntries(storage: PlaceListStorage | null = browserStorage()): PlaceListEntry[] | null {
    if (!storage) return null;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return dated ? parseEntries(parsed, max) : parseIds(parsed, max).map((id) => ({ id, savedAt: "" }));
    } catch {
      return null;
    }
  }

  /** null: localStorage no está disponible (o falla). */
  function read(storage: PlaceListStorage | null = browserStorage()): string[] | null {
    return readEntries(storage)?.map((entry) => entry.id) ?? null;
  }

  function writeCookie(ids: string[]) {
    try {
      if (typeof document === "undefined") return;
      const value = idsCookieValue(ids, max);
      document.cookie = value
        ? `${cookieName}=${value}; path=/; max-age=${ONE_YEAR}; SameSite=Lax`
        : `${cookieName}=; path=/; max-age=0; SameSite=Lax`;
    } catch {
      // Sin cookie, el servidor sigue sin la lista.
    }
  }

  function readCookie(): string | null {
    try {
      if (typeof document === "undefined") return null;
      const entry = document.cookie.split("; ").find((part) => part.startsWith(`${cookieName}=`));
      return entry ? entry.slice(cookieName.length + 1) : "";
    } catch {
      return null;
    }
  }

  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function write(entries: PlaceListEntry[], storage: PlaceListStorage | null): boolean {
    if (!storage) return false;
    const ids = entries.map((entry) => entry.id);
    try {
      storage.setItem(storageKey, JSON.stringify(dated ? entries : ids));
    } catch {
      return false;
    }
    writeCookie(ids);
    notify();
    return true;
  }

  /** Agrega o saca el lugar (el que se agrega va primero; al pasar el tope se van los más viejos). false si no se pudo. */
  function toggle(id: string, storage: PlaceListStorage | null = browserStorage(), now: Date = new Date()): boolean {
    const current = readEntries(storage);
    if (current === null) return false;
    const next = current.some((entry) => entry.id === id)
      ? current.filter((entry) => entry.id !== id)
      : [{ id, savedAt: dated ? now.toISOString() : "" }, ...current];
    return write(next.slice(0, max), storage);
  }

  /** Borra toda la lista (localStorage y cookie). */
  function clear(storage: PlaceListStorage | null = browserStorage()) {
    try {
      storage?.removeItem(storageKey);
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
    const ids = read();
    if (ids !== null && readCookie() !== idsCookieValue(ids, max)) writeCookie(ids);
  }

  function subscribe(listener: () => void) {
    syncCookie();
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) listener();
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
    const entries = readEntries();
    return entries === null ? UNAVAILABLE : JSON.stringify(entries);
  };
  const serverSnapshot = () => "[]";

  /** La lista actual; available false si localStorage no funciona (no se muestra el botón). */
  function useList(): PlaceListState {
    const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
    if (raw === UNAVAILABLE) return { available: false, ids: [], entries: [] };
    const entries = JSON.parse(raw) as PlaceListEntry[];
    return { available: true, ids: entries.map((entry) => entry.id), entries };
  }

  return { read, readEntries, toggle, clear, useList };
}
