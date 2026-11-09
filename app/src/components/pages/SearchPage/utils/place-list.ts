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
/** Para el botón de una card: available false si localStorage no funciona (no se muestra). */
export type PlaceMembership = { available: boolean; active: boolean };

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

// Snapshot de useList cuando localStorage no está disponible.
const UNAVAILABLE = "";

export function createPlaceList({ storageKey, cookieName, max, dated }: Options) {
  /** El texto guardado tal cual; undefined si localStorage no está disponible (o falla). */
  function readRaw(storage: PlaceListStorage | null): string | null | undefined {
    if (!storage) return undefined;
    try {
      return storage.getItem(storageKey);
    } catch {
      return undefined;
    }
  }

  /** null: el texto no es JSON (se trata como localStorage roto). Sin dated, savedAt queda vacío. */
  function parseRaw(raw: string | null): PlaceListEntry[] | null {
    try {
      const parsed: unknown = JSON.parse(raw ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return dated ? parseEntries(parsed, max) : parseIds(parsed, max).map((id) => ({ id, savedAt: "" }));
    } catch {
      return null;
    }
  }

  /** null: localStorage no está disponible (o falla). Sin dated, savedAt queda vacío. */
  function readEntries(storage: PlaceListStorage | null = browserStorage()): PlaceListEntry[] | null {
    const raw = readRaw(storage);
    return raw === undefined ? null : parseRaw(raw);
  }

  /**
   * La lista ya leída, cacheada por el texto de localStorage: sólo se vuelve a parsear y validar cuando ese texto cambia.
   * Cada botón de la card (me gusta, guardar) la consulta en cada render y en cada cambio; sin esto, 42 cards eran 42
   * JSON.parse y 42 validaciones por toque.
   */
  type ListState = { entries: PlaceListEntry[] | null; ids: Set<string>; json: string };
  let cached: { storage: PlaceListStorage | null; raw: string | null | undefined; state: ListState } | null = null;

  function stateOf(storage: PlaceListStorage | null = browserStorage()): ListState {
    const raw = readRaw(storage);
    if (cached && cached.storage === storage && cached.raw === raw) return cached.state;
    const entries = raw === undefined ? null : parseRaw(raw);
    const state = { entries, ids: new Set(entries?.map((entry) => entry.id) ?? []), json: entries === null ? UNAVAILABLE : JSON.stringify(entries) };
    cached = { storage, raw, state };
    return state;
  }

  /** -1: localStorage no está disponible; 1: el lugar está en la lista; 0: no está. */
  function membership(id: string, storage: PlaceListStorage | null = browserStorage()): -1 | 0 | 1 {
    const state = stateOf(storage);
    if (state.entries === null) return -1;
    return state.ids.has(id) ? 1 : 0;
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

  // Un solo listener de "storage" (cambios desde otra pestaña) para todos los suscriptores, no uno por botón.
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) notify();
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

  // Un string estable como snapshot (el JSON cacheado de stateOf): "" = localStorage no disponible.
  const snapshot = () => stateOf().json;
  const serverSnapshot = () => "[]";

  /** La lista actual; available false si localStorage no funciona (no se muestra el botón). */
  function useList(): PlaceListState {
    const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
    if (raw === UNAVAILABLE) return { available: false, ids: [], entries: [] };
    const entries = JSON.parse(raw) as PlaceListEntry[];
    return { available: true, ids: entries.map((entry) => entry.id), entries };
  }

  // En el servidor (y al hidratar) la lista está disponible y vacía, como serverSnapshot.
  const serverMembership = () => 0 as const;

  /**
   * Si el lugar está en la lista, para el botón de su card. El snapshot es un número: al cambiar la lista sólo se vuelve a
   * renderizar el botón cuyo valor cambió, no los de todas las cards.
   */
  function useHas(id: string): PlaceMembership {
    const value = useSyncExternalStore(subscribe, () => membership(id), serverMembership);
    return { available: value !== -1, active: value === 1 };
  }

  return { read, readEntries, toggle, clear, useList, useHas, membership, stateOf };
}
