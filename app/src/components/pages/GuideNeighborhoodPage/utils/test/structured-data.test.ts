import { describe, expect, it } from "vitest";
import { neighborhoodItemListJsonLd } from "../structured-data";

describe("JSON-LD del barrio", () => {
  const data = neighborhoodItemListJsonLd({
    name: "Cordón",
    path: "/guides/montevideo/cordon",
    siteUrl: "https://salimos.uy",
    groups: [
      { guides: [{ title: "Para compartir con amigos", href: "/guides/montevideo/cordon/para-compartir-con-amigos" }] },
      { guides: [{ title: "Cafés donde nadie te apura", href: "/guides/montevideo/cordon/cafes-donde-nadie-te-apura" }] },
    ],
  });

  it("un ItemList de las guías en el orden de la página", () => {
    expect(data).toMatchObject({
      "@type": "ItemList",
      name: "Guías de Cordón",
      url: "https://salimos.uy/guides/montevideo/cordon",
      numberOfItems: 2,
    });
    expect(data.itemListElement.map((item) => [item.position, item.url])).toEqual([
      [1, "https://salimos.uy/guides/montevideo/cordon/para-compartir-con-amigos"],
      [2, "https://salimos.uy/guides/montevideo/cordon/cafes-donde-nadie-te-apura"],
    ]);
  });

  it("sin BreadcrumbList (todavía no existe /guides/montevideo)", () => {
    expect(JSON.stringify(data)).not.toMatch(/BreadcrumbList/);
  });
});
