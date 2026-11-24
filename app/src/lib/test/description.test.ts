import { describe, expect, it } from "vitest";
import { SHARE_DESCRIPTION_MAX, shareDescription, truncateAtWord } from "../description";

describe("truncateAtWord", () => {
  it("deja igual un texto que entra y junta los espacios", () => {
    expect(truncateAtWord("  Bar de  barrio\ncon picadas. ", 125)).toBe("Bar de barrio con picadas.");
  });

  it("corta en una palabra, sin puntuación antes del …, y nunca pasa del máximo", () => {
    const text = "Parrilla clásica de Cordón, ".repeat(10);
    for (const max of [125, 155]) {
      const result = truncateAtWord(text, max)!;
      expect(result.length).toBeLessThanOrEqual(max);
      expect(result).toMatch(/[^\s,]…$/);
      expect(text.startsWith(result.slice(0, -1))).toBe(true);
    }
  });

  it("una sola palabra larga se corta igual", () => {
    expect(truncateAtWord("a".repeat(200), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("undefined si está vacío", () => {
    expect(truncateAtWord(null, 125)).toBeUndefined();
    expect(truncateAtWord("   ", 125)).toBeUndefined();
  });
});

describe("shareDescription", () => {
  it("usa el máximo para compartir", () => {
    const text = "Guías elegidas a mano para salir en Montevideo: dónde comer, bares, cafés y postres, por barrio y en toda la ciudad, con mapa.";
    const result = shareDescription(text);
    expect(text.length).toBeGreaterThan(SHARE_DESCRIPTION_MAX);
    expect(result.length).toBeLessThanOrEqual(SHARE_DESCRIPTION_MAX);
    expect(result.endsWith("…")).toBe(true);
  });
});
