import { describe, expect, it } from "vitest";
import { cityCollectionJsonLd } from "../structured-data";

describe("JSON-LD de la ciudad", () => {
  const data = cityCollectionJsonLd({
    title: "Montevideo",
    description: "Guías para salir en Montevideo.",
    path: "/guides/montevideo",
    siteUrl: "https://sitio.example",
    groups: [
      { guides: [{ title: "Lugares de sushi para una cita", href: "/guides/montevideo/sushi-para-una-cita" }] },
      { guides: [{ title: "Cafés donde nadie te apura", href: "/guides/montevideo/cafes-donde-nadie-te-apura" }] },
    ],
  });

  it("CollectionPage con un ItemList de las guías en el orden de la página", () => {
    expect(data).toMatchObject({ "@type": "CollectionPage", name: "Montevideo", url: "https://sitio.example/guides/montevideo" });
    expect(data.mainEntity["@type"]).toBe("ItemList");
    expect(data.mainEntity.itemListElement.map((item) => [item.position, item.url])).toEqual([
      [1, "https://sitio.example/guides/montevideo/sushi-para-una-cita"],
      [2, "https://sitio.example/guides/montevideo/cafes-donde-nadie-te-apura"],
    ]);
  });

  it("sin BreadcrumbList (es la raíz) ni nada de Google", () => {
    expect(JSON.stringify(data)).not.toMatch(/BreadcrumbList|rating|google|geo/i);
  });
});
