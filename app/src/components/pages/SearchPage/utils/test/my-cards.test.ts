import { describe, expect, it } from "vitest";
import { MY_CARDS_KEY } from "@/lib/my-cards";
import { readMyCards, setMyCards } from "../my-cards";

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

describe("guardar mis tarjetas", () => {
  it("guarda sólo las válidas y las lee igual", () => {
    const storage = memoryStorage();
    expect(setMyCards(["itau.credit", "banco.debit", "brou.debit", "itau.credit"], storage)).toBe(true);
    expect(JSON.parse(storage.data.get(MY_CARDS_KEY)!)).toEqual(["itau.credit", "brou.debit"]);
    expect(readMyCards(storage)).toEqual(["itau.credit", "brou.debit"]);
  });

  it("reemplaza las anteriores", () => {
    const storage = memoryStorage({ [MY_CARDS_KEY]: JSON.stringify(["itau.credit"]) });
    setMyCards(["santander.debit"], storage);
    expect(readMyCards(storage)).toEqual(["santander.debit"]);
  });

  it("sin localStorage (o roto, o con basura) no hay tarjetas y guardar da false", () => {
    expect(readMyCards(null)).toEqual([]);
    expect(readMyCards(broken)).toEqual([]);
    expect(readMyCards(memoryStorage({ [MY_CARDS_KEY]: "{roto" }))).toEqual([]);
    expect(readMyCards(memoryStorage({ [MY_CARDS_KEY]: '{"a":1}' }))).toEqual([]);
    expect(setMyCards(["itau.credit"], null)).toBe(false);
    expect(setMyCards(["itau.credit"], broken)).toBe(false);
  });
});
