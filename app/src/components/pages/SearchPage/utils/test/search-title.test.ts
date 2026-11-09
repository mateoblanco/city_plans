import { describe, expect, it } from "vitest";
import { searchHeading, searchTitle } from "../search-title";

const barrio = (label: string, from: "text" | "bar") => ({ kind: "neighborhood" as const, label, fromText: from === "text", fromFilter: from === "bar" });

describe("título de /search", () => {
  it("un verbo de la intención se lee con el sustantivo: Bares para tomar algo en Montevideo", () => {
    expect(searchTitle({ query: "tomar algo", intent: "bars", chips: [] })).toBe("Bares para tomar algo en Montevideo · Salimos");
    expect(searchHeading({ query: "salir a comer", intent: "eat", chips: [] })).toBe("Salir a comer en Montevideo");
    expect(searchHeading({ query: "tomar un cafe", intent: "cafes", chips: [] })).toBe("Cafés para tomar un cafe en Montevideo");
    // Si el sustantivo ya dice el verbo, no se repite.
    expect(searchHeading({ query: "Comer", intent: "eat", chips: [] })).toBe("Lugares para comer en Montevideo");
  });

  it("sin verbo de la intención, la consulta tal cual (con mayúscula); un barrio del texto ya está en la consulta", () => {
    expect(searchTitle({ query: "almorzar en Ciudad Vieja", intent: "eat", chips: [barrio("Ciudad Vieja", "text")] })).toBe("Almorzar en Ciudad Vieja · Salimos");
    expect(searchHeading({ query: "pizza", intent: null, chips: [] })).toBe("Pizza en Montevideo");
  });

  it("el barrio de la barra se agrega; sin barrio, Montevideo", () => {
    expect(searchHeading({ query: "", intent: "cafes", chips: [barrio("Pocitos", "bar")] })).toBe("Cafés en Pocitos");
    expect(searchHeading({ query: "", intent: "cafes", chips: [barrio("Pocitos", "bar"), barrio("Cordón", "bar")] })).toBe("Cafés en Pocitos y Cordón");
    expect(searchHeading({ query: "", intent: "desserts", chips: [] })).toBe("Lugares de postres en Montevideo");
  });

  it("sin texto ni intención", () => {
    expect(searchTitle({ query: "", intent: null, chips: [] })).toBe("Lugares para salir en Montevideo · Salimos");
  });

  it("la consulta larga se corta en una palabra", () => {
    const heading = searchHeading({ query: "un lugar tranquilo para trabajar con buena conexion y enchufes cerca de la rambla", intent: null, chips: [] });
    expect(heading.endsWith("… en Montevideo")).toBe(true);
    expect(heading.length).toBeLessThan(80);
  });
});
