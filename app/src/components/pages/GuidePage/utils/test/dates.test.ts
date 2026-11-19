import { describe, expect, it } from "vitest";
import { guideDate } from "../dates";

describe("fecha de actualización", () => {
  it("en español, sin correrse un día por la zona horaria", () => {
    expect(guideDate("2026-11-19")).toBe("19 de noviembre de 2026");
    expect(guideDate("2027-01-01")).toBe("1 de enero de 2027");
  });
});
