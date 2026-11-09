import { describe, expect, it } from "vitest";
import { SHORTCUTS } from "../shortcuts";

describe("accesos directos de la home", () => {
  it("las intenciones van estructuradas, sin texto; las dietas, al filtro de la barra", () => {
    expect(SHORTCUTS).toEqual([
      { text: "Comer", href: "/search?intent=eat" },
      { text: "Tomar algo", href: "/search?intent=bars" },
      { text: "Cafés", href: "/search?intent=cafes" },
      { text: "Postres", href: "/search?intent=desserts" },
      { text: "Vegetariano", href: "/search?f=diet%3Avegetarian" },
      { text: "Vegano", href: "/search?f=diet%3Avegan" },
      { text: "Sin TACC", href: "/search?f=diet%3AglutenFree" },
    ]);
  });
});
