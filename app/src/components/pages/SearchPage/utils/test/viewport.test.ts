import { describe, expect, it } from "vitest";
import { movedEnough } from "../viewport";

describe("movedEnough", () => {
  const view = { south: -34.92, west: -56.16, north: -34.9, east: -56.14 };

  it("un arrastre de más del 10 % o un zoom cuentan; un temblor no", () => {
    expect(movedEnough(view, view)).toBe(false);
    expect(movedEnough(view, { ...view, north: view.north + 0.001, south: view.south + 0.001 })).toBe(false);
    expect(movedEnough(view, { ...view, north: view.north + 0.005, south: view.south + 0.005 })).toBe(true);
    expect(movedEnough(view, { ...view, east: view.east + 0.004, west: view.west + 0.004 })).toBe(true);
    // Zoom: el mismo centro, la mitad del tamaño.
    expect(movedEnough(view, { south: -34.915, west: -56.155, north: -34.905, east: -56.145 })).toBe(true);
  });
});
