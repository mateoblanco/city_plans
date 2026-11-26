import { describe, expect, it } from "vitest";
import { estimatedMapTop, mapLikelyAboveFold } from "../static-map";

// Escaramuza: en Chrome a 390×844 el mapa empieza en 674px (medido en noviembre de 2026 con los íconos de los chips, que
// pasan a tres filas; antes, en dos filas, 618px).
const escaramuza = {
  name: "Escaramuza",
  description:
    "Librería-café y espacio cultural en una casona antigua de 1903 en el Cordón, sobre una calle tranquila. Es un punto de encuentro para leer, tomar algo y participar de talleres y presentaciones. Tiene pascualina y postres para acompañar.",
  chips: ["Opciones sin TACC", "Al aire libre", "Eventos", "Libros", "Para trabajar"],
};

describe("mapLikelyAboveFold", () => {
  it("se acerca a lo medido en el navegador", () => {
    expect(Math.abs(estimatedMapTop(escaramuza) - 674)).toBeLessThanOrEqual(30);
  });

  it("una ficha común: el mapa entra en la primera pantalla", () => {
    expect(mapLikelyAboveFold(escaramuza)).toBe(true);
    expect(mapLikelyAboveFold({ name: "Bar", description: null, chips: [] })).toBe(true);
  });

  it("con una descripción muy larga o un nombre de varias líneas, queda abajo", () => {
    expect(mapLikelyAboveFold({ ...escaramuza, description: escaramuza.description.repeat(3) })).toBe(false);
    expect(estimatedMapTop({ ...escaramuza, name: "Un nombre muy largo de varias palabras" })).toBeGreaterThan(estimatedMapTop(escaramuza));
  });
});
