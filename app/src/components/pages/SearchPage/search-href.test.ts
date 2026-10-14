import { describe, expect, it } from "vitest";
import { addFilterHref, nearHref, removeChipHref, searchHref, setNeighborhoodHref } from "./search-href";

describe("searchHref", () => {
  it("suma el chip a los remove que ya estaban, sin duplicar", () => {
    const href = searchHref({ q: "brunch en cordón", remove: "tag:terrace", add: { kind: "neighborhood", id: "CORDON" } });
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("q")).toBe("brunch en cordón");
    expect(params.get("remove")).toBe("tag:terrace,neighborhood:CORDON");
    expect(searchHref({ q: "a", remove: "tag:terrace", add: { kind: "tag", id: "terrace" } })).toBe("/search?q=a&remove=tag%3Aterrace");
  });

  it("conserva debug y omite remove vacío", () => {
    expect(searchHref({ q: "café & té", debug: true })).toBe("/search?q=caf%C3%A9+%26+t%C3%A9&debug=1");
    expect(searchHref({ q: "x", remove: " , " })).toBe("/search?q=x");
  });

  it("sin texto queda sólo con los filtros", () => {
    expect(searchHref({ q: "", f: "category:cafe,open:now" })).toBe("/search?f=category%3Acafe%2Copen%3Anow");
    expect(searchHref({ q: "" })).toBe("/search");
  });
});

const read = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);

describe("chips y barra de filtros", () => {
  const state = { q: "pizza", remove: "tag:terrace", f: "diet:vegan,neighborhood:CORDON", near: "-34.905,-56.185" };

  it("quitar un chip que vino de un filtro lo saca de f sin tocar remove", () => {
    expect(read(removeChipHref(state, { kind: "diet", id: "vegan", fromText: false, fromFilter: true }))).toEqual({
      q: "pizza",
      remove: "tag:terrace",
      f: "neighborhood:CORDON",
      near: "-34.905,-56.185",
    });
  });

  it("quitar un chip del texto lo suma a remove; si vino de los dos, también lo saca de f", () => {
    expect(read(removeChipHref(state, { kind: "category", id: "pizzeria", fromText: true, fromFilter: false })).remove).toBe("tag:terrace,category:pizzeria");
    const both = read(removeChipHref(state, { kind: "diet", id: "vegan", fromText: true, fromFilter: true }));
    expect(both.remove).toBe("tag:terrace,diet:vegan");
    expect(both.f).toBe("neighborhood:CORDON");
  });

  it("quitar el chip de cerca mío saca la ubicación", () => {
    expect(read(removeChipHref(state, { kind: "near", id: "me" })).near).toBeUndefined();
  });

  it("prender un filtro lo suma a f y lo saca de remove", () => {
    const href = read(addFilterHref({ q: "cafés", remove: "openAt:now,tag:terrace" }, { kind: "openAt", id: "now" }));
    expect(href).toEqual({ q: "cafés", remove: "tag:terrace", f: "open:now" });
  });

  it("el barrio reemplaza al anterior y quita el del texto; Todos también", () => {
    expect(read(setNeighborhoodHref(state, "POCITOS", [])).f).toBe("diet:vegan,neighborhood:POCITOS");
    // "cafés en Pocitos" + Cordón en la barra: Pocitos se quita, así sacar Cordón no lo hace volver.
    const pocitos = [{ kind: "neighborhood", id: "POCITOS", fromText: true, fromFilter: false }];
    expect(read(setNeighborhoodHref({ q: "cafés en pocitos" }, "CORDON", pocitos))).toEqual({
      q: "cafés en pocitos",
      remove: "neighborhood:POCITOS",
      f: "neighborhood:CORDON",
    });
    // Elegir en la barra el mismo barrio del texto no lo quita.
    expect(read(setNeighborhoodHref({ q: "cafés en pocitos" }, "POCITOS", pocitos))).toEqual({ q: "cafés en pocitos", f: "neighborhood:POCITOS" });
    const all = read(setNeighborhoodHref({ q: "cafés en pocitos" }, null, [{ kind: "neighborhood", id: "POCITOS", fromText: true, fromFilter: false }]));
    expect(all).toEqual({ q: "cafés en pocitos", remove: "neighborhood:POCITOS" });
  });

  it("cerca mío redondea las coordenadas a 3 decimales", () => {
    expect(read(nearHref({ q: "café" }, -34.9058123, -56.1847999)).near).toBe("-34.906,-56.185");
  });
});
