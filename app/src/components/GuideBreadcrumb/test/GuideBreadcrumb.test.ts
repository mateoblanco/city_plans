import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuideHeader from "@/components/pages/GuidePage/GuideHeader/GuideHeader";
import NeighborhoodHeader from "@/components/pages/GuideNeighborhoodPage/NeighborhoodHeader/NeighborhoodHeader";
import CityHeader from "@/components/pages/GuidesCityPage/CityHeader/CityHeader";
import { guideBreadcrumb, neighborhoodBreadcrumb } from "@/server/guides/catalog";
import { CORDON_CAFES, POCITOS_PIZZA, SUSHI_CITY } from "@/server/guides/test/fixtures";

const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
const current = (html: string) => html.match(/<li[^>]*aria-current="page"[^>]*>(?:<span[^>]*>\/<\/span>)?([^<]*)<\/li>/)?.[1];

const guideHeader = (breadcrumb: ReturnType<typeof guideBreadcrumb>, title: string, neighborhood: string | null = null) =>
  renderToStaticMarkup(createElement(GuideHeader, { breadcrumb, neighborhood, title, updatedAt: "2026-11-19", intro: [] }));

/** Cordón tiene su página activa (llega al mínimo); Pocitos no. */
const ACTIVE = new Set(["CORDON"]);

describe("migas de las guías", () => {
  it("ciudad: sin migas", () => {
    const html = renderToStaticMarkup(createElement(CityHeader, { title: "Montevideo", intro: ["Intro."] }));
    expect(html).not.toContain("Migas de pan");
    expect(links(html)).toEqual([]);
    expect(html).toMatch(/<h1[^>]*>Montevideo<\/h1>/);
  });

  it("barrio: Montevideo (link) / Cordón (actual, sin link)", () => {
    const html = renderToStaticMarkup(createElement(NeighborhoodHeader, { breadcrumb: neighborhoodBreadcrumb("CORDON"), name: "Cordón", intro: [] }));
    expect(links(html)).toEqual([["/guides/montevideo", "Montevideo"]]);
    expect(current(html)).toBe("Cordón");
  });

  it("guía de un barrio con página: Montevideo (link) / Cordón (link), sin la guía, y la etiqueta Cordón (sin el grupo)", () => {
    const guide = CORDON_CAFES;
    const html = guideHeader(guideBreadcrumb(guide, ACTIVE), guide.title, "Cordón");
    expect(links(html)).toEqual([
      ["/guides/montevideo", "Montevideo"],
      ["/guides/montevideo/cordon", "Cordón"],
    ]);
    expect(current(html)).toBe(undefined);
    expect(html).not.toContain(">Cafés donde nadie te apura</li>");
    expect(html).not.toContain(">Cafés</li>");
    expect(html).toContain(">Cordón</li>");
  });

  it("guía de un barrio sin página (debajo del mínimo): sólo Montevideo, pero con la etiqueta Pocitos", () => {
    const html = guideHeader(guideBreadcrumb(POCITOS_PIZZA, ACTIVE), POCITOS_PIZZA.title, "Pocitos");
    expect(links(html)).toEqual([["/guides/montevideo", "Montevideo"]]);
    expect(current(html)).toBe(undefined);
    expect(html).toContain(">Pocitos</li>");
  });

  it("guía de ciudad: sólo Montevideo (link), sin etiquetas", () => {
    const guide = SUSHI_CITY;
    const html = guideHeader(guideBreadcrumb(guide, ACTIVE), guide.title);
    expect(links(html)).toEqual([["/guides/montevideo", "Montevideo"]]);
    expect(current(html)).toBe(undefined);
    expect(html).not.toMatch(/<li[^>]*class="[^"]*tag/);
  });
});
