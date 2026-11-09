import { describe, expect, it } from "vitest";
import { EAGER_HOME_CARDS, EAGER_SEARCH_CARDS, eagerImage } from "../eager-images";

describe("eagerImage", () => {
  it("en /search: las dos primeras high, las dos siguientes eager y el resto lazy", () => {
    const loads = Array.from({ length: 6 }, (_, index) => eagerImage(index, EAGER_SEARCH_CARDS));
    expect(loads).toEqual(["high", "high", "eager", "eager", undefined, undefined]);
  });

  it("en la home: las dos primeras high y el resto lazy", () => {
    expect([0, 1, 2].map((index) => eagerImage(index, EAGER_HOME_CARDS))).toEqual(["high", "high", undefined]);
  });

  it("sin eagerCount (otra sección), ninguna", () => {
    expect(eagerImage(0, undefined)).toBeUndefined();
  });

  it("con 0, ninguna", () => {
    expect(eagerImage(0, 0)).toBeUndefined();
  });
});
