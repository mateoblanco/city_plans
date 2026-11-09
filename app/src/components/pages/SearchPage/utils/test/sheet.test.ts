import { describe, expect, it } from "vitest";
import { isTap, nextSnapPoint, SHEET_HIGH, SHEET_LOW, SHEET_MID, TAP_SLOP_PX, toSnapPoint } from "../sheet";

describe("toSnapPoint", () => {
  it("acepta sólo las tres alturas del panel y baja cualquier otra cosa (cerrar)", () => {
    expect(toSnapPoint(SHEET_MID)).toBe(SHEET_MID);
    expect(toSnapPoint(SHEET_HIGH)).toBe(SHEET_HIGH);
    expect(toSnapPoint(SHEET_LOW)).toBe(SHEET_LOW);
    expect(toSnapPoint("120px")).toBe(SHEET_LOW);
    expect(toSnapPoint(null)).toBe(SHEET_LOW);
    expect(toSnapPoint(0.7)).toBe(SHEET_LOW);
  });
});

describe("manija del panel", () => {
  it("alterna entre la media y la alta; desde la baja, a la media", () => {
    expect(nextSnapPoint(SHEET_MID)).toBe(SHEET_HIGH);
    expect(nextSnapPoint(SHEET_HIGH)).toBe(SHEET_MID);
    expect(nextSnapPoint(SHEET_LOW)).toBe(SHEET_MID);
  });

  it("un toque cuenta; el final de un arrastre no", () => {
    const down = { x: 100, y: 500 };
    expect(isTap(down, { x: 103, y: 504, detail: 1 })).toBe(true);
    expect(isTap(down, { x: 100, y: 500 + TAP_SLOP_PX + 1, detail: 1 })).toBe(false);
    expect(isTap(down, { x: 100, y: 300, detail: 1 })).toBe(false);
  });

  it("con teclado (detail 0) siempre cuenta", () => {
    expect(isTap(null, { x: 0, y: 0, detail: 0 })).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 0, y: 400, detail: 0 })).toBe(true);
  });
});
