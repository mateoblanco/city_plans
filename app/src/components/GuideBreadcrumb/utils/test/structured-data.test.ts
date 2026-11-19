import { describe, expect, it } from "vitest";
import { findGuide, guideBreadcrumb, neighborhoodBreadcrumb } from "@/server/guides/catalog";
import { breadcrumbJsonLd } from "../structured-data";

const BASE = "https://salimos.uy";

describe("BreadcrumbList", () => {
  it("barrio: posiciones y URLs absolutas reales", () => {
    expect(breadcrumbJsonLd(neighborhoodBreadcrumb("CORDON"), BASE)).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Guías de Montevideo", item: `${BASE}/guides/montevideo` },
        { "@type": "ListItem", position: 2, name: "Cordón", item: `${BASE}/guides/montevideo/cordon` },
      ],
    });
  });

  it("guía de barrio: tres tramos, el último es la guía", () => {
    const data = breadcrumbJsonLd(guideBreadcrumb(findGuide("cordon", "cafes-donde-nadie-te-apura")!), BASE);
    expect(data.itemListElement.map((item) => [item.position, item.item])).toEqual([
      [1, `${BASE}/guides/montevideo`],
      [2, `${BASE}/guides/montevideo/cordon`],
      [3, `${BASE}/guides/montevideo/cordon/cafes-donde-nadie-te-apura`],
    ]);
  });
});
