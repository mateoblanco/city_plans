import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
// En los tests (sin svgr) un .svg es una URL: la flecha va como un componente vacío.
vi.mock("@/assets/arrow_right.svg", () => ({ default: () => null }));

import PlaceGuides from "@/components/pages/PlacePage/PlaceGuides/PlaceGuides";
import HomeGuidesList from "../HomeGuidesList/HomeGuidesList";

const guide = (slug: string, neighborhood: string | null, count: number) => ({ slug, title: `Guía ${slug}`, href: `/guides/montevideo/${slug}`, neighborhood, count });

describe("sección Guías de la home", () => {
  it("sin guías publicadas, no aparece", () => {
    expect(renderToStaticMarkup(createElement(HomeGuidesList, { guides: [] }))).toBe("");
  });

  it("el título y la flecha llevan a todas las guías; cada link, el título y el barrio (si tiene), sin cantidad", () => {
    const html = renderToStaticMarkup(createElement(HomeGuidesList, { guides: [guide("cafes", "Pocitos", 9), guide("sushi", null, 1)] }));
    expect(html).toMatch(/<h2[^>]*><a[^>]*href="\/guides\/montevideo"[^>]*>Guías<\/a><\/h2>/);
    expect(html).toMatch(/<a(?=[^>]*aria-label="Ver todas las guías")(?=[^>]*href="\/guides\/montevideo")[^>]*>/);
    expect(html).toContain('href="/guides/montevideo/cafes"');
    expect(html).toMatch(/>Pocitos</);
    expect(html).not.toMatch(/lugar/);
    expect(html).not.toContain("<img");
  });
});

describe("Aparece en estas guías (ficha)", () => {
  it("sin guías, no aparece; con guías, un link por título", () => {
    expect(renderToStaticMarkup(createElement(PlaceGuides, { guides: [] }))).toBe("");
    const html = renderToStaticMarkup(createElement(PlaceGuides, { guides: [guide("primera-cita", null, 10)] }));
    expect(html).toMatch(/<h2[^>]*>Aparece en estas guías<\/h2>/);
    expect(html).toMatch(/<a[^>]*href="\/guides\/montevideo\/primera-cita"[^>]*>Guía primera-cita<\/a>/);
  });
});
