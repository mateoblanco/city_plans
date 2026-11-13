import { describe, expect, it } from "vitest";
import { MY_CARDS_KEY } from "@/lib/my-cards";
import { SAVED_KEY } from "@/components/pages/SearchPage/utils/saved";
import { choiceCount, markWelcomeDone, shouldShowWelcome, toggleChoice, WELCOME_KEY } from "../welcome";

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
    throw new Error("SecurityError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("cuándo aparece la bienvenida", () => {
  it("la primera vez, sí", () => {
    expect(shouldShowWelcome(memoryStorage())).toBe(true);
  });

  it("terminada o salteada (con la marca), no vuelve", () => {
    const storage = memoryStorage();
    markWelcomeDone(storage);
    expect(storage.data.get(WELCOME_KEY)).toBe("1");
    expect(shouldShowWelcome(storage)).toBe(false);
  });

  it("con guardados o tarjetas de antes, no aparece y queda marcada", () => {
    const withSaved = memoryStorage({ [SAVED_KEY]: JSON.stringify([{ id: id(1), savedAt: "2026-10-01T00:00:00.000Z" }]) });
    expect(shouldShowWelcome(withSaved)).toBe(false);
    expect(withSaved.data.get(WELCOME_KEY)).toBe("1");
    const withCards = memoryStorage({ [MY_CARDS_KEY]: JSON.stringify(["itau.credit"]) });
    expect(shouldShowWelcome(withCards)).toBe(false);
    expect(withCards.data.get(WELCOME_KEY)).toBe("1");
  });

  it("sin localStorage (o roto), no aparece", () => {
    expect(shouldShowWelcome(null)).toBe(false);
    expect(shouldShowWelcome(broken)).toBe(false);
    expect(() => markWelcomeDone(broken)).not.toThrow();
  });
});

describe("hasta 3 lugares", () => {
  it("marca, desmarca y no pasa de 3", () => {
    let selected: string[] = [];
    for (const place of ["a", "b", "c", "d"]) selected = toggleChoice(selected, place);
    expect(selected).toEqual(["a", "b", "c"]);
    expect(choiceCount(selected)).toBe("3 de 3");
    selected = toggleChoice(selected, "b");
    expect(selected).toEqual(["a", "c"]);
    expect(choiceCount(selected)).toBe("2 de 3");
    expect(toggleChoice(selected, "d")).toEqual(["a", "c", "d"]);
  });
});
