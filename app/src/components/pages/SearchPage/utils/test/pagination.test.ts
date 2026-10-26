import { describe, expect, it } from "vitest";
import type { SearchResponse, SearchResult } from "@/server/search";
import { hasViewAll, mapPlaces, PAGE_SIZE, visiblePage } from "../pagination";

const place = (id: string, branches: SearchResult["branches"] = []) => ({ id, name: id, lat: -34.9, lng: -56.16, iconCategory: null, branches }) as unknown as SearchResult;
const places = (n: number, prefix = "p") => Array.from({ length: n }, (_, index) => place(`${prefix}${index}`));
const ids = (list: SearchResult[] | null) => (list ?? []).map((item) => item.id);

describe("Ver más sin grupos", () => {
  const results = places(30);

  it("de a 12, en el orden de la respuesta, hasta el final", () => {
    expect(PAGE_SIZE).toBe(12);
    const first = visiblePage({ results, sections: null, forYou: null }, 1);
    expect(ids(first.list)).toEqual(ids(results.slice(0, 12)));
    expect(first.hasMore).toBe(true);
    expect(visiblePage({ results, sections: null, forYou: null }, 2).list).toHaveLength(24);
    const last = visiblePage({ results, sections: null, forYou: null }, 3);
    expect(last.list).toHaveLength(30);
    expect(last.hasMore).toBe(false);
  });

  it("una lista corta ya está al final", () => {
    expect(visiblePage({ results: places(5), sections: null, forYou: null }, 1)).toMatchObject({ hasMore: false, sections: null, forYou: null });
  });
});

describe("Para vos", () => {
  const results = places(20);
  const forYou: SearchResponse["forYou"] = { id: "for_you", title: "Para vos", placeIds: ["p5", "p9", "p14"], total: null };

  it("va arriba de la lista, que no los repite y sigue en el mismo orden", () => {
    const page = visiblePage({ results, sections: null, forYou }, 1);
    expect(ids(page.forYou?.places ?? null)).toEqual(["p5", "p9", "p14"]);
    expect(page.list).toHaveLength(12);
    expect(ids(page.list)).toEqual(ids(results.filter((item) => !["p5", "p9", "p14"].includes(item.id)).slice(0, 12)));
    expect(ids(page.places).slice(0, 3)).toEqual(["p5", "p9", "p14"]);
    expect(page.forYou && hasViewAll(page.forYou)).toBe(false);
    const all = visiblePage({ results, sections: null, forYou }, 2);
    expect(all.hasMore).toBe(false);
    expect(all.list).toHaveLength(17);
  });
});

describe("con grupos", () => {
  const results = [...places(6, "g"), ...places(3, "d"), ...places(20, "m")];
  const sections: SearchResponse["sections"] = [
    { id: "share", title: "Para compartir", placeIds: ids(results.slice(0, 6)), total: 9 },
    { id: "discover", title: "Descubrí", placeIds: ["d0", "d1", "d2"], total: null },
    { id: "more", title: "Más opciones", placeIds: ids(results.slice(9)), total: null },
  ];

  it("los grupos completos y Más opciones de a 12; el mapa, sólo lo visible", () => {
    const first = visiblePage({ results, sections, forYou: null }, 1);
    expect(first.sections?.map((section) => section.places.length)).toEqual([6, 3, 12]);
    expect(first.hasMore).toBe(true);
    expect(first.places).toHaveLength(21);
    const second = visiblePage({ results, sections, forYou: null }, 2);
    expect(second.sections?.at(-1)?.places).toHaveLength(20);
    expect(second.hasMore).toBe(false);
  });

  it("Ver todos sólo si el grupo tiene más de los que muestra", () => {
    const [share, discover] = visiblePage({ results, sections, forYou: null }, 1).sections!;
    expect(hasViewAll(share)).toBe(true);
    expect(hasViewAll(discover)).toBe(false);
    expect(hasViewAll({ ...share, total: 6 })).toBe(false);
  });

  it("los grupos personales no tienen Ver todos", () => {
    const personal: SearchResponse["sections"] = [{ id: "profile", title: "Basado en lo que te gusta", placeIds: ["d0", "d1", "d2"], total: null }, ...sections!];
    const [profile] = visiblePage({ results, sections: personal, forYou: null }, 1).sections!;
    expect(profile.title).toBe("Basado en lo que te gusta");
    expect(hasViewAll(profile)).toBe(false);
  });
});

it("el mapa tiene un punto por card y por cada sucursal, apuntando a su card", () => {
  const points = mapPlaces([place("a", [{ id: "a2", lat: -34.8, lng: -56.1 }]), place("b")]);
  expect(points.map(({ id, cardId }) => [id, cardId])).toEqual([["a", "a"], ["a2", "a"], ["b", "b"]]);
});
