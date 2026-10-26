import { describe, expect, it } from "vitest";
import { clearLikes, LIKES_KEY, readLikes, toggleLike } from "../likes";
import { likesCookieValue, parseLikesCookie } from "../likes-cookie";

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

describe("likes en localStorage", () => {
  it("guarda o saca el id; el último va primero", () => {
    const storage = memoryStorage();
    expect(toggleLike(id(1), storage)).toBe(true);
    expect(toggleLike(id(2), storage)).toBe(true);
    expect(readLikes(storage)).toEqual([id(2), id(1)]);
    toggleLike(id(1), storage);
    expect(readLikes(storage)).toEqual([id(2)]);
    // Sólo ids.
    expect(JSON.parse(storage.data.get(LIKES_KEY)!)).toEqual([id(2)]);
    clearLikes(storage);
    expect(readLikes(storage)).toEqual([]);
  });

  it("si localStorage falla, la app sigue sin likes y nada tira error", () => {
    expect(readLikes(broken)).toBeNull();
    expect(readLikes(null)).toBeNull();
    expect(toggleLike(id(1), broken)).toBe(false);
    expect(() => clearLikes(broken)).not.toThrow();
    expect(readLikes(memoryStorage({ [LIKES_KEY]: "{roto" }))).toBeNull();
    expect(readLikes(memoryStorage({ [LIKES_KEY]: '"no es una lista"' }))).toEqual([]);
  });

  it("como mucho 100: al pasar el tope se van los más viejos", () => {
    const storage = memoryStorage({ [LIKES_KEY]: JSON.stringify(Array.from({ length: 100 }, (_, n) => id(n))) });
    toggleLike(id(500), storage);
    const likes = readLikes(storage)!;
    expect(likes).toHaveLength(100);
    expect(likes[0]).toBe(id(500));
    expect(likes).not.toContain(id(99));
  });
});

describe("cookie espejo", () => {
  it("los 100 más recientes, en menos de 4 KB", () => {
    const ids = Array.from({ length: 150 }, (_, n) => id(n));
    const value = likesCookieValue(ids);
    expect(parseLikesCookie(value)).toEqual(ids.slice(0, 100));
    expect(`likes=${value}`.length).toBeLessThan(4096);
  });

  it("descarta ids inválidos y repetidos", () => {
    expect(parseLikesCookie(`${id(1)}.nada.${id(1)}.<script>.${id(2)}`)).toEqual([id(1), id(2)]);
    expect(parseLikesCookie(undefined)).toEqual([]);
    expect(parseLikesCookie("")).toEqual([]);
  });
});
