import { describe, expect, it, vi } from "vitest";
import { placeDescription, placeTitle } from "../metadata";

vi.mock("server-only", () => ({}));

const ramona = { name: "Ramona", categories: ["cafe", "bakery"], description_es: null };

describe("título y descripción de la ficha", () => {
  it("título: nombre · categoría en barrio, Montevideo", () => {
    expect(placeTitle(ramona, "Buceo")).toBe("Ramona · Café en Buceo, Montevideo");
    expect(placeTitle({ ...ramona, categories: [] }, "Buceo")).toBe("Ramona · En Buceo, Montevideo");
    expect(placeTitle(ramona, null)).toBe("Ramona · Café en Montevideo");
  });

  it("descripción: la nuestra, cortada en una palabra a 155 con …", () => {
    expect(placeDescription({ ...ramona, description_es: " Café de barrio\n con patio. " }, "Buceo")).toBe("Café de barrio con patio.");
    const long = placeDescription({ ...ramona, description_es: "palabra ".repeat(40) }, "Buceo");
    expect(long.length).toBeLessThanOrEqual(155);
    expect(long.endsWith("palabra…")).toBe(true);
  });

  it("sin descripción, una frase con la categoría y el barrio", () => {
    expect(placeDescription(ramona, "Buceo")).toBe("Ramona: café en Buceo, Montevideo.");
    expect(placeDescription({ ...ramona, categories: [] }, "Buceo")).toBe("Ramona: en Buceo, Montevideo.");
  });
});
