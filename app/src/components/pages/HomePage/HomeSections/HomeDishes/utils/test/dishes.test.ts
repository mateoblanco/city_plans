import { describe, expect, it } from "vitest";
import { DISHES } from "../dishes";

describe("platos de la home", () => {
  it("en orden, cada uno a /search con su nombre como texto", () => {
    expect(DISHES.map((dish) => dish.text)).toEqual(["Hamburguesas", "Sushi", "Pastas", "Chivito", "Parrilla", "Pizza", "Milanesas", "Empanadas"]);
    expect(DISHES[0].href).toBe("/search?q=Hamburguesas");
    for (const dish of DISHES) expect(new URL(dish.href, "https://x.test").searchParams.get("q")).toBe(dish.text);
  });
});
