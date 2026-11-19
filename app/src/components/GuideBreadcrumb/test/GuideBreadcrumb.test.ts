import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuideHeader from "@/components/pages/GuidePage/GuideHeader/GuideHeader";
import NeighborhoodHeader from "@/components/pages/GuideNeighborhoodPage/NeighborhoodHeader/NeighborhoodHeader";
import CityHeader from "@/components/pages/GuidesCityPage/CityHeader/CityHeader";
import { findCityGuide, findGuide, guideBreadcrumb, neighborhoodBreadcrumb, visibleGuides } from "@/server/guides/catalog";

const links = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
const current = (html: string) => html.match(/<li[^>]*aria-current="page"[^>]*>(?:<span[^>]*>\/<\/span>)?([^<]*)<\/li>/)?.[1];

const guideHeader = (breadcrumb: ReturnType<typeof guideBreadcrumb>, title: string) =>
  renderToStaticMarkup(createElement(GuideHeader, { breadcrumb, group: "Cafés", title, updatedAt: "2026-11-19", intro: [] }));

describe("migas de las guías", () => {
  it("ciudad: sin migas", () => {
    const html = renderToStaticMarkup(createElement(CityHeader, { title: "Guías de Montevideo", intro: ["Intro."] }));
    expect(html).not.toContain("Migas de pan");
    expect(links(html)).toEqual([]);
    expect(html).toMatch(/<h1[^>]*>Guías de Montevideo<\/h1>/);
  });

  it("barrio: Guías de Montevideo (link) / Cordón (actual, sin link)", () => {
    const html = renderToStaticMarkup(createElement(NeighborhoodHeader, { breadcrumb: neighborhoodBreadcrumb("CORDON"), name: "Cordón", intro: [] }));
    expect(links(html)).toEqual([["/guides/montevideo", "Guías de Montevideo"]]);
    expect(current(html)).toBe("Cordón");
  });

  it("guía de barrio: Guías de Montevideo (link) / Cordón (link) / título (actual)", () => {
    const guide = findGuide("cordon", "cafes-donde-nadie-te-apura")!;
    const html = guideHeader(guideBreadcrumb(guide), guide.title);
    expect(links(html)).toEqual([
      ["/guides/montevideo", "Guías de Montevideo"],
      ["/guides/montevideo/cordon", "Cordón"],
    ]);
    expect(current(html)).toBe("Cafés donde nadie te apura");
  });

  it("guía de ciudad: Guías de Montevideo (link) / título (actual), sin barrio", () => {
    const guide = findCityGuide("sushi-para-una-cita", visibleGuides({ NODE_ENV: "development" }))!;
    const html = guideHeader(guideBreadcrumb(guide), guide.title);
    expect(links(html)).toEqual([["/guides/montevideo", "Guías de Montevideo"]]);
    expect(current(html)).toBe("Lugares de sushi para una cita");
  });
});
