import { describe, expect, it } from "vitest";
import { cityCollectionJsonLd } from "../structured-data";

describe("JSON-LD de la ciudad", () => {
  const data = cityCollectionJsonLd({
    title: "Guías de Montevideo",
    description: "Guías para salir en Montevideo.",
    path: "/guides/montevideo",
    siteUrl: "https://salimos.uy",
    groups: [
      { guides: [{ title: "Lugares de sushi para una cita", href: "/guides/montevideo/sushi-para-una-cita" }] },
      { guides: [{ title: "Cafés donde nadie te apura", href: "/guides/montevideo/cordon/cafes-donde-nadie-te-apura" }] },
    ],
  });

  it("CollectionPage con un ItemList de las guías en el orden de la página", () => {
    expect(data).toMatchObject({ "@type": "CollectionPage", name: "Guías de Montevideo", url: "https://salimos.uy/guides/montevideo" });
    expect(data.mainEntity["@type"]).toBe("ItemList");
    expect(data.mainEntity.itemListElement.map((item) => [item.position, item.url])).toEqual([
      [1, "https://salimos.uy/guides/montevideo/sushi-para-una-cita"],
      [2, "https://salimos.uy/guides/montevideo/cordon/cafes-donde-nadie-te-apura"],
    ]);
  });

  it("sin BreadcrumbList (es la raíz) ni nada de Google", () => {
    expect(JSON.stringify(data)).not.toMatch(/BreadcrumbList|rating|google|geo/i);
  });
});
