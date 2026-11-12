import { describe, expect, it } from "vitest";
import { clearSaved, readSaved, readSavedEntries, SAVED_KEY, savedMembership, toggleSaved } from "../saved";
import { MAX_SAVED, parseSavedCookie, savedCookieValue } from "../saved-cookie";
import { SEARCH_CONFIG } from "@/server/search/config";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

const broken = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 12));

describe("guardados en localStorage", () => {
  it("guarda o saca el id con la fecha; el último va primero", () => {
    const storage = memoryStorage();
    expect(toggleSaved(id(1), storage, day(1))).toBe(true);
    expect(toggleSaved(id(2), storage, day(2))).toBe(true);
    expect(readSaved(storage)).toEqual([id(2), id(1)]);
    expect(readSavedEntries(storage)).toEqual([
      { id: id(2), savedAt: day(2).toISOString() },
      { id: id(1), savedAt: day(1).toISOString() },
    ]);
    toggleSaved(id(1), storage, day(3));
    expect(readSaved(storage)).toEqual([id(2)]);
    // Volver a guardar lo pone primero con la fecha nueva.
    toggleSaved(id(1), storage, day(4));
    expect(readSavedEntries(storage)![0]).toEqual({ id: id(1), savedAt: day(4).toISOString() });
    clearSaved(storage);
    expect(readSaved(storage)).toEqual([]);
  });

  it("es la única lista: localStorage guarda id y fecha, la cookie sólo ids", () => {
    const storage = memoryStorage();
    toggleSaved(id(1), storage, day(1));
    expect([...storage.data.keys()]).toEqual([SAVED_KEY]);
    expect(JSON.parse(storage.data.get(SAVED_KEY)!)).toEqual([{ id: id(1), savedAt: day(1).toISOString() }]);
  });

  it("MAX_SAVED (cliente) es el mismo que SEARCH_CONFIG.personal.maxLikes (servidor)", () => {
    expect(MAX_SAVED).toBe(SEARCH_CONFIG.personal.maxLikes);
  });

  it("si localStorage falla, la app sigue sin guardados y nada tira error", () => {
    expect(readSaved(broken)).toBeNull();
    expect(readSaved(null)).toBeNull();
    expect(toggleSaved(id(1), broken)).toBe(false);
    expect(() => clearSaved(broken)).not.toThrow();
    expect(readSaved(memoryStorage({ [SAVED_KEY]: "{roto" }))).toBeNull();
    expect(readSaved(memoryStorage({ [SAVED_KEY]: '"no es una lista"' }))).toEqual([]);
  });

  it("descarta entradas inválidas y repetidas (queda la más reciente)", () => {
    const at = day(1).toISOString();
    const storage = memoryStorage({
      [SAVED_KEY]: JSON.stringify([
        { id: id(1), savedAt: at },
        id(2),
        { id: "nada", savedAt: at },
        { id: id(3), savedAt: "no es fecha" },
        { id: id(4) },
        { id: id(1), savedAt: day(0).toISOString() },
        { id: id(5), savedAt: at },
      ]),
    });
    expect(readSavedEntries(storage)).toEqual([
      { id: id(1), savedAt: at },
      { id: id(5), savedAt: at },
    ]);
  });

  it("como mucho 100: al pasar el tope se van los más viejos", () => {
    const at = day(1).toISOString();
    const storage = memoryStorage({ [SAVED_KEY]: JSON.stringify(Array.from({ length: 100 }, (_, n) => ({ id: id(n), savedAt: at }))) });
    toggleSaved(id(500), storage, day(2));
    const saved = readSaved(storage)!;
    expect(saved).toHaveLength(100);
    expect(saved[0]).toBe(id(500));
    expect(saved).not.toContain(id(99));
  });
});

describe("cookie espejo de guardados", () => {
  it("sólo ids, los 100 más recientes, en menos de 4 KB", () => {
    const ids = Array.from({ length: 150 }, (_, n) => id(n));
    const value = savedCookieValue(ids);
    expect(parseSavedCookie(value)).toEqual(ids.slice(0, 100));
    expect(`saved=${value}`.length).toBeLessThan(4096);
  });

  it("descarta ids inválidos y repetidos", () => {
    expect(parseSavedCookie(`${id(1)}.nada.${id(1)}.<script>.${id(2)}`)).toEqual([id(1), id(2)]);
    expect(parseSavedCookie(undefined)).toEqual([]);
    expect(parseSavedCookie("")).toEqual([]);
  });
});

describe("corazón de cada card (por id)", () => {
  it("sólo dice si ese lugar está guardado", () => {
    const storage = memoryStorage();
    toggleSaved(id(1), storage, day(1));
    expect(savedMembership(id(1), storage)).toBe(1);
    expect(savedMembership(id(2), storage)).toBe(0);
    expect(savedMembership(id(1), broken)).toBe(-1);
  });
});
