import { describe, expect, it } from "vitest";
import { SHEET_HIGH, SHEET_LOW, SHEET_MID, toSnapPoint } from "../sheet";

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
