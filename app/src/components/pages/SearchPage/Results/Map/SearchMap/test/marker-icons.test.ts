import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_CATEGORY_KEYS } from "@shared/icon-categories.ts";
import { MARKER_ICONS } from "../marker-icons";

const ICONS_DIR = path.resolve(import.meta.dirname, "../../../../../../../../../shared/icons");
const files = readdirSync(ICONS_DIR)
  .filter((file) => file.endsWith(".svg"))
  .map((file) => file.slice(0, -".svg".length))
  .sort();

describe("íconos de los marcadores", () => {
  it("cada categoría tiene su SVG", () => {
    const missing = ICON_CATEGORY_KEYS.filter((key) => !files.includes(key));
    expect(missing).toEqual([]);
  });

  it("no hay SVG sin categoría", () => {
    const keys: readonly string[] = ICON_CATEGORY_KEYS;
    const extra = files.filter((file) => !keys.includes(file));
    expect(extra).toEqual([]);
  });

  it("MARKER_ICONS tiene un import por cada SVG", () => {
    expect(Object.keys(MARKER_ICONS).sort()).toEqual(files);
  });
});
