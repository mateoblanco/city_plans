import { describe, expect, it } from "vitest";
import { guideItemListJsonLd } from "../structured-data";

describe("JSON-LD de la guía", () => {
  const data = guideItemListJsonLd({
    title: "Cafés donde nadie te apura",
    url: "/guides/montevideo/cafes-donde-nadie-te-apura",
    siteUrl: "https://sitio.example",
    places: [
      { number: 1, slug: "inocencio-cafe", name: "Inocencio Café" },
      { number: 2, slug: "sauco-cafe", name: "Sauco café" },
    ],
  });

  it("un ItemList con la posición, el nombre y la URL de la ficha de cada lugar", () => {
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Cafés donde nadie te apura",
      url: "https://sitio.example/guides/montevideo/cafes-donde-nadie-te-apura",
      numberOfItems: 2,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Inocencio Café", url: "https://sitio.example/place/inocencio-cafe" },
        { "@type": "ListItem", position: 2, name: "Sauco café", url: "https://sitio.example/place/sauco-cafe" },
      ],
    });
  });

  it("sin BreadcrumbList (todavía no hay páginas de ciudad ni barrio) ni nada de Google", () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/BreadcrumbList|aggregateRating|rating|geo|latitude|openingHours|telephone|google/i);
  });
});
