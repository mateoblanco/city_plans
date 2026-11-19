import { describe, expect, it } from "vitest";
import { pinBounds } from "../pins";

describe("pinBounds", () => {
  it("encierra todos los pins; sin pins, null", () => {
    expect(
      pinBounds([
        { id: "a", number: 1, name: "A", lat: -34.9, lng: -56.18 },
        { id: "b", number: 2, name: "B", lat: -34.89, lng: -56.16 },
      ]),
    ).toEqual({ north: -34.89, south: -34.9, east: -56.16, west: -56.18 });
    expect(pinBounds([])).toBeNull();
  });
});
