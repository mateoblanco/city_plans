import { describe, expect, it } from "vitest";
import { INTENT_IDS } from "@shared/intents.ts";
import { HOME_PLACEHOLDERS, INTENT_PLACEHOLDERS, placeholdersFor } from "../placeholders";

describe("placeholdersFor", () => {
  it("con una intención, sus ejemplos", () => {
    for (const id of INTENT_IDS) expect(placeholdersFor(id)).toBe(INTENT_PLACEHOLDERS[id]);
  });

  it("sin intención o con una que no existe, el mix", () => {
    expect(placeholdersFor(null)).toBe(HOME_PLACEHOLDERS);
    expect(placeholdersFor(undefined)).toBe(HOME_PLACEHOLDERS);
    expect(placeholdersFor("pizza")).toBe(HOME_PLACEHOLDERS);
  });

  it("cada intención tiene ejemplos", () => {
    for (const id of INTENT_IDS) expect(INTENT_PLACEHOLDERS[id].length).toBeGreaterThan(0);
  });
});
