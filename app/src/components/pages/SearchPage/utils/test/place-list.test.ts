import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlaceList } from "../place-list";

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

const list = () => createPlaceList({ storageKey: "test.list", cookieName: "test", max: 100, dated: false });

afterEach(() => vi.restoreAllMocks());

describe("membresía por id (botón de cada card)", () => {
  it("1 si el lugar está en la lista, 0 si no; -1 sin localStorage", () => {
    const places = list();
    const storage = memoryStorage();
    expect(places.membership(id(1), storage)).toBe(0);
    places.toggle(id(1), storage);
    expect(places.membership(id(1), storage)).toBe(1);
    expect(places.membership(id(2), storage)).toBe(0);
    places.toggle(id(1), storage);
    expect(places.membership(id(1), storage)).toBe(0);
    expect(places.membership(id(1), broken)).toBe(-1);
    expect(places.membership(id(1), null)).toBe(-1);
    // Un JSON roto se trata como localStorage roto, igual que readEntries.
    expect(places.membership(id(1), memoryStorage({ "test.list": "{roto" }))).toBe(-1);
  });
});

describe("lista cacheada por el texto de localStorage", () => {
  it("con el mismo texto no vuelve a parsear ni validar: devuelve el mismo estado", () => {
    const places = list();
    const storage = memoryStorage({ "test.list": JSON.stringify([id(1), id(2)]) });
    const parse = vi.spyOn(JSON, "parse");
    const first = places.stateOf(storage);
    // 42 botones consultando la misma lista: una sola lectura.
    for (let n = 0; n < 42; n++) places.membership(id(n), storage);
    expect(places.stateOf(storage)).toBe(first);
    expect(parse).toHaveBeenCalledTimes(1);
    expect([...first.ids]).toEqual([id(1), id(2)]);
  });

  it("cuando la lista cambia, se lee de nuevo", () => {
    const places = list();
    const storage = memoryStorage();
    const before = places.stateOf(storage);
    places.toggle(id(3), storage);
    const after = places.stateOf(storage);
    expect(after).not.toBe(before);
    expect(after.ids.has(id(3))).toBe(true);
    // El snapshot de useList (JSON estable) sigue igual que antes del cache.
    expect(after.json).toBe(JSON.stringify([{ id: id(3), savedAt: "" }]));
  });

  it("también cambia si otra pestaña escribe directo en localStorage", () => {
    const places = list();
    const storage = memoryStorage();
    expect(places.membership(id(4), storage)).toBe(0);
    storage.setItem("test.list", JSON.stringify([id(4)]));
    expect(places.membership(id(4), storage)).toBe(1);
  });
});
