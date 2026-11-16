import { describe, expect, it } from "vitest";
import { emptyBar } from "@/server/search/intents";
import { runSearch, type SearchResponse } from "@/server/search/search";
import { fakeCache, fakeStore, row } from "@/server/search/test/fixtures";
import { clearTextHref, type SearchUrl } from "../search-href";

// Lunes 13:00 de Montevideo.
const now = new Date("2026-10-12T16:00:00Z");

const places = [
  row({ id: "bar", categories: ["bar"], tags: ["classic_cocktails", "live_music"], neighborhoodId: "POCITOS" }),
  row({ id: "cafe", categories: ["cafe"], tags: ["specialty_coffee", "brunch"] }),
  row({ id: "resto", categories: ["restaurant"], tags: ["dinner", "sushi"], neighborhoodId: "POCITOS", diet: { vegan: "has_options", vegetarian: "has_options", glutenFree: "unknown" } }),
];

async function search(state: SearchUrl): Promise<SearchResponse> {
  const { store } = fakeStore(places);
  return runSearch(state.q, { store, cache: fakeCache().cache }, { now, remove: state.remove, intent: state.intent, sub: state.sub, filters: state.f, loc: state.loc, userLocation: "-34.905,-56.185" });
}

const read = (href: string) => Object.fromEntries(new URL(href, "http://x").searchParams);
const list = (raw: string | undefined) => (raw ? raw.split(",").sort() : []);

/** Borrar el texto con lo que devolvió la búsqueda, como hace el × de /search. */
async function cleared(state: SearchUrl) {
  const response = await search(state);
  return { response, params: read(clearTextHref(state, response.interpreted.chips, response.bar)) };
}

describe("clearTextHref: borrar el texto", () => {
  it("conserva barrio y dieta del texto (pasan a f) y saca q y remove", async () => {
    const { response, params } = await cleared({ q: "vegano en pocitos", remove: "tag:terrace" });
    expect(response.interpreted.chips.some((chip) => chip.kind === "neighborhood" && chip.fromText)).toBe(true);
    expect(params.q).toBeUndefined();
    expect(params.remove).toBeUndefined();
    expect(list(params.f)).toEqual(["diet:vegan", "neighborhood:POCITOS"]);
  });

  it("saca los chips de horario del texto: Hoy, Esta noche, Hoy al mediodía", async () => {
    for (const q of ["bares hoy", "bares esta noche", "almorzar hoy"]) {
      const { response, params } = await cleared({ q, f: "diet:vegan" });
      expect(response.interpreted.chips.some((chip) => chip.kind === "openAt"), q).toBe(true);
      expect(list(params.f), q).toEqual(["diet:vegan"]);
    }
  });

  it("'Abierto ahora' del texto es un filtro de la barra: queda", async () => {
    const { params } = await cleared({ q: "bares abierto ahora" });
    expect(list(params.f)).toContain("open:now");
  });

  it("mantiene la pestaña: la de la URL y la que eligió el texto", async () => {
    expect((await cleared({ q: "con amigos", intent: "eat" })).params.intent).toBe("eat");
    const { response, params } = await cleared({ q: "bares" });
    expect(response.bar.intent).toEqual({ id: "bars", fromText: true });
    expect(params.intent).toBe("bars");
  });

  it("mantiene los sub-filtros activos, de la URL y del texto", async () => {
    const { response, params } = await cleared({ q: "cócteles", intent: "bars", sub: "live_music" });
    const active = response.bar.subs.filter((sub) => sub.active).map((sub) => sub.id);
    expect(active.length).toBeGreaterThan(1);
    expect(list(params.sub)).toEqual([...active].sort());
  });

  it("mantiene todo f (descuentos, sección, tag) y loc", async () => {
    const f = "discount:itau.credit,section:outdoor,tag:brunch,open:now";
    const { params } = await cleared({ q: "pizza", f, loc: "all" });
    expect(list(params.f)).toEqual(list(f));
    expect(params.loc).toBe("all");
  });

  it("'cerca mío' del texto pasa a loc=near; un loc de la URL gana", async () => {
    expect((await cleared({ q: "café cerca mío" })).params.loc).toBe("near");
    expect((await cleared({ q: "café cerca mío", loc: "all" })).params.loc).toBe("all");
  });

  it("sin la respuesta de la búsqueda (falló), sólo con la URL", () => {
    const state = { q: "pizza", remove: "dish:pizza", intent: "eat", sub: "lunch", f: "open:now", loc: "near" };
    expect(read(clearTextHref(state, [], emptyBar()))).toEqual({ intent: "eat", sub: "lunch", f: "open:now", loc: "near" });
  });

  it("conserva debug y profile=off", () => {
    expect(clearTextHref({ q: "x", debug: true, profile: false }, [], emptyBar())).toBe("/search?debug=1&profile=off");
  });
});
