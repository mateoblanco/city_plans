import { describe, expect, it } from "vitest";
import { addFilterHref, extraHref, intentHref, nearHref, removeChipHref, searchHref, sectionHref, setNeighborhoodsHref, subHref, widenUrl, type BarRef } from "../search-href";

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
    expect(searchHref({ q: "", f: "diet:vegan,open:today" })).toBe("/search?f=diet%3Avegan%2Copen%3Atoday");
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
    const href = read(addFilterHref({ q: "cafés", remove: "openAt:today,tag:terrace" }, { kind: "openAt", id: "today" }));
    expect(href).toEqual({ q: "cafés", remove: "tag:terrace", f: "open:today" });
  });

  it("los barrios reemplazan a los anteriores y quitan los del texto; Todos también", () => {
    expect(read(setNeighborhoodsHref(state, ["POCITOS"], [], null)).f).toBe("diet:vegan,neighborhood:POCITOS");
    expect(read(setNeighborhoodsHref(state, ["POCITOS", "PARQUE RODO"], [], null)).f).toBe("diet:vegan,neighborhood:POCITOS,neighborhood:PARQUE RODO");
    // "cafés en Pocitos" + Cordón en la barra: Pocitos se quita, así sacar Cordón no lo hace volver.
    const pocitos = [{ kind: "neighborhood", id: "POCITOS", fromText: true, fromFilter: false }];
    expect(read(setNeighborhoodsHref({ q: "cafés en pocitos" }, ["CORDON"], pocitos, null))).toEqual({
      q: "cafés en pocitos",
      remove: "neighborhood:POCITOS",
      f: "neighborhood:CORDON",
    });
    // Elegir en la barra el mismo barrio del texto no lo quita.
    expect(read(setNeighborhoodsHref({ q: "cafés en pocitos" }, ["POCITOS"], pocitos, null))).toEqual({ q: "cafés en pocitos", f: "neighborhood:POCITOS" });
    const all = read(setNeighborhoodsHref({ q: "cafés en pocitos" }, [], [{ kind: "neighborhood", id: "POCITOS", fromText: true, fromFilter: false }], null));
    expect(all).toEqual({ q: "cafés en pocitos", remove: "neighborhood:POCITOS" });
    // Sumar Cordón al Pocitos del texto: quedan los dos, y Pocitos deja de estar quitado si lo estaba.
    expect(read(setNeighborhoodsHref({ q: "cafés en pocitos", remove: "neighborhood:POCITOS" }, ["POCITOS", "CORDON"], pocitos, null))).toEqual({
      q: "cafés en pocitos",
      f: "neighborhood:POCITOS,neighborhood:CORDON",
    });
  });

  it("barrios y cerca mío se excluyen: cada uno saca al otro", () => {
    expect(read(setNeighborhoodsHref(state, ["POCITOS"], [], null)).near).toBeUndefined();
    expect(read(setNeighborhoodsHref(state, [], [], "-34.9,-56.16"))).toEqual({ q: "pizza", remove: "tag:terrace", f: "diet:vegan", near: "-34.9,-56.16" });
  });

  it("cerca mío redondea las coordenadas a 3 decimales", () => {
    expect(read(nearHref({ q: "café" }, -34.9058123, -56.1847999)).near).toBe("-34.906,-56.185");
  });
});

describe("intención y sub-filtros", () => {
  const empty: BarRef = { intent: null, textIntent: null, subs: [], extras: [] };
  // "cócteles y pizza en cordón" con Bares elegido por el texto.
  const fromText: BarRef = {
    intent: { id: "bars", fromText: true },
    textIntent: "bars",
    subs: [
      { id: "cocktails", active: true, fromText: true, removeKeys: ["tag:classic_cocktails"] },
      { id: "live_music", active: false, fromText: false, removeKeys: [] },
    ],
    extras: [{ kind: "dish", id: "pizza", fromText: true }],
  };
  const state = { q: "bares con cócteles y pizza", f: "neighborhood:CORDON,diet:vegan", near: "-34.905,-56.185" };

  it("intent y sub van en la URL; sub sólo con intent", () => {
    expect(searchHref({ q: "", intent: "bars", sub: "cocktails,live_music" })).toBe("/search?intent=bars&sub=cocktails%2Clive_music");
    expect(searchHref({ q: "x", sub: "cocktails" })).toBe("/search?q=x");
  });

  it("cambiar de intención limpia los sub-filtros (de la URL y del texto) y conserva f y near", () => {
    expect(read(intentHref({ ...state, intent: "bars", sub: "live_music" }, "cafes", fromText))).toEqual({
      q: "bares con cócteles y pizza",
      // "bares" no se quita: la categoría vuelve a filtrar y se ve como extra.
      remove: "intent:bars,tag:classic_cocktails,dish:pizza",
      intent: "cafes",
      f: "neighborhood:CORDON,diet:vegan",
      near: "-34.905,-56.185",
    });
  });

  it("apagar la intención activa vuelve a Todo", () => {
    expect(read(intentHref({ q: "", intent: "bars", sub: "wine" }, null, { ...empty, intent: { id: "bars", fromText: false } }))).toEqual({});
  });

  it("apagar la intención del texto no pierde la categoría", () => {
    // "bar con amigos" (o "boliche" → Para bailar, por categoría): sólo se quita la intención.
    const bar: BarRef = {
      ...empty,
      intent: { id: "bars", fromText: true },
      textIntent: "bars",
      subs: [{ id: "dancing", active: true, fromText: true, removeKeys: ["category:night_club"] }],
      extras: [{ kind: "category", id: "wine_bar", fromText: true }],
    };
    expect(read(intentHref({ q: "bar con amigos" }, null, bar))).toEqual({ q: "bar con amigos", remove: "intent:bars" });
  });

  it("sin intención previa, elegir una conserva los extras", () => {
    const terraza: BarRef = { ...empty, extras: [{ kind: "tag", id: "terrace", fromText: true }] };
    expect(read(intentHref({ q: "con terraza" }, "eat", terraza))).toEqual({ q: "con terraza", intent: "eat" });
  });

  it("prender un sub-filtro fija la intención del texto en la URL", () => {
    expect(read(subHref(state, "live_music", fromText))).toMatchObject({ intent: "bars", sub: "live_music" });
  });

  it("apagar un sub-filtro del texto lo suma a remove; uno de la URL lo saca de sub", () => {
    expect(read(subHref(state, "cocktails", fromText))).toMatchObject({ intent: "bars", remove: "tag:classic_cocktails" });
    expect(read(subHref(state, "cocktails", fromText)).sub).toBeUndefined();
    const fromUrl: BarRef = { ...empty, intent: { id: "bars", fromText: false }, subs: [{ id: "wine", active: true, fromText: false, removeKeys: [] }] };
    expect(read(subHref({ q: "", intent: "bars", sub: "wine,beer" }, "wine", fromUrl))).toEqual({ intent: "bars", sub: "beer" });
  });

  it("quitar un extra usa remove y deja la intención fija", () => {
    expect(read(extraHref(state, { kind: "dish", id: "pizza", fromText: true }, fromText))).toMatchObject({ intent: "bars", remove: "dish:pizza" });
  });
});

describe("Ver todos e invitación a ampliar", () => {
  const state = { q: "salir a comer con amigos", f: "neighborhood:CORDON", debug: true };

  it("Ver todos suma la sección a f y reemplaza otra que hubiera", () => {
    expect(sectionHref(state, "outdoor")).toBe("/search?q=salir+a+comer+con+amigos&f=neighborhood%3ACORDON%2Csection%3Aoutdoor&debug=1");
    expect(sectionHref({ ...state, f: "section:casual" }, "share")).toBe("/search?q=salir+a+comer+con+amigos&f=section%3Ashare&debug=1");
  });

  it("el chip de la sección se apaga sacándolo de f", () => {
    const chip = { kind: "section", id: "outdoor", fromText: false, fromFilter: true };
    expect(removeChipHref({ ...state, f: "neighborhood:CORDON,section:outdoor" }, chip)).toBe(searchHref(state));
  });

  it("widen pide la misma búsqueda a /api/search/widen, sin debug", () => {
    expect(widenUrl(state)).toBe("/api/search/widen?q=salir+a+comer+con+amigos&f=neighborhood%3ACORDON");
  });
});
