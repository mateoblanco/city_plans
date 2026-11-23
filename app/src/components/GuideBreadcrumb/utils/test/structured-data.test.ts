import { describe, expect, it } from "vitest";
import { guideBreadcrumb, neighborhoodBreadcrumb } from "@/server/guides/catalog";
import { CORDON_CAFES, POCITOS_PIZZA } from "@/server/guides/test/fixtures";
import { breadcrumbJsonLd } from "../structured-data";

const BASE = "https://sitio.example";

describe("BreadcrumbList", () => {
  it("barrio: posiciones y URLs absolutas reales", () => {
    expect(breadcrumbJsonLd(neighborhoodBreadcrumb("CORDON"), BASE)).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Montevideo", item: `${BASE}/guides/montevideo` },
        { "@type": "ListItem", position: 2, name: "Cordón", item: `${BASE}/guides/montevideo/cordon` },
      ],
    });
  });

  it("guía de un barrio con página: tres tramos, el último es la guía (URL plana)", () => {
    const data = breadcrumbJsonLd(guideBreadcrumb(CORDON_CAFES, new Set(["CORDON"])), BASE);
    expect(data.itemListElement.map((item) => [item.position, item.item])).toEqual([
      [1, `${BASE}/guides/montevideo`],
      [2, `${BASE}/guides/montevideo/cordon`],
      [3, `${BASE}/guides/montevideo/cafes-donde-nadie-te-apura`],
    ]);
  });

  it("guía de un barrio sin página: dos tramos, sin el barrio", () => {
    const data = breadcrumbJsonLd(guideBreadcrumb(POCITOS_PIZZA, new Set(["CORDON"])), BASE);
    expect(data.itemListElement.map((item) => item.item)).toEqual([`${BASE}/guides/montevideo`, `${BASE}/guides/montevideo/pizzas-en-pocitos`]);
  });
});
