import { describe, expect, it } from "vitest";
import { addFilterHref, barIntentHref, extraHref, intentHref, nearbyHref, removeChipHref, searchHref, sectionHref, setDietsHref, setLocationHref, setNeighborhoodsHref, setPricesHref, zoneHref, subHref, widenUrl, type BarRef } from "../search-href";

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
  const state = { q: "pizza", remove: "tag:terrace", f: "diet:vegan,neighborhood:CORDON", loc: "near" };

  it("quitar un chip que vino de un filtro lo saca de f sin tocar remove", () => {
    expect(read(removeChipHref(state, { kind: "diet", id: "vegan", fromText: false, fromFilter: true }))).toEqual({
      q: "pizza",
      remove: "tag:terrace",
      f: "neighborhood:CORDON",
      loc: "near",
    });
  });

  it("quitar un chip del texto lo suma a remove; si vino de los dos, también lo saca de f", () => {
    expect(read(removeChipHref(state, { kind: "category", id: "pizzeria", fromText: true, fromFilter: false })).remove).toBe("tag:terrace,category:pizzeria");
    const both = read(removeChipHref(state, { kind: "diet", id: "vegan", fromText: true, fromFilter: true }));
    expect(both.remove).toBe("tag:terrace,diet:vegan");
    expect(both.f).toBe("neighborhood:CORDON");
  });

  it("quitar el chip de cerca mío pasa a todo Montevideo (sin loc volvería a cerca mío, el valor por defecto)", () => {
    expect(read(removeChipHref(state, { kind: "near", id: "me" })).loc).toBe("all");
  });

  it("prender un filtro lo suma a f y lo saca de remove", () => {
    const href = read(addFilterHref({ q: "cafés", remove: "openAt:today,tag:terrace" }, { kind: "openAt", id: "today" }));
    expect(href).toEqual({ q: "cafés", remove: "tag:terrace", f: "open:today" });
  });

  it("los barrios reemplazan a los anteriores y quitan los del texto; Todos también", () => {
    expect(read(setNeighborhoodsHref(state, ["POCITOS"], [])).f).toBe("diet:vegan,neighborhood:POCITOS");
    expect(read(setNeighborhoodsHref(state, ["POCITOS", "PARQUE RODO"], [])).f).toBe("diet:vegan,neighborhood:POCITOS,neighborhood:PARQUE RODO");
    // "cafés en Pocitos" + Cordón en la barra: Pocitos se quita, así sacar Cordón no lo hace volver.
    const pocitos = [{ kind: "neighborhood", id: "POCITOS", fromText: true, fromFilter: false }];
    expect(read(setNeighborhoodsHref({ q: "cafés en pocitos" }, ["CORDON"], pocitos))).toEqual({
      q: "cafés en pocitos",
      remove: "neighborhood:POCITOS",
      f: "neighborhood:CORDON",
    });
    // Elegir en la barra el mismo barrio del texto no lo quita.
    expect(read(setNeighborhoodsHref({ q: "cafés en pocitos" }, ["POCITOS"], pocitos))).toEqual({ q: "cafés en pocitos", f: "neighborhood:POCITOS" });
    const all = read(setNeighborhoodsHref({ q: "cafés en pocitos" }, [], [{ kind: "neighborhood", id: "POCITOS", fromText: true, fromFilter: false }]));
    expect(all).toEqual({ q: "cafés en pocitos", remove: "neighborhood:POCITOS" });
    // Sumar Cordón al Pocitos del texto: quedan los dos, y Pocitos deja de estar quitado si lo estaba.
    expect(read(setNeighborhoodsHref({ q: "cafés en pocitos", remove: "neighborhood:POCITOS" }, ["POCITOS", "CORDON"], pocitos))).toEqual({
      q: "cafés en pocitos",
      f: "neighborhood:POCITOS,neighborhood:CORDON",
    });
  });

  it("barrios y la ubicación (cerca mío, todo Montevideo, zona) se excluyen: cada uno saca al otro", () => {
    expect(read(setNeighborhoodsHref(state, ["POCITOS"], [])).loc).toBeUndefined();
    expect(read(setLocationHref(state, "near", []))).toEqual({ q: "pizza", remove: "tag:terrace", f: "diet:vegan", loc: "near" });
    expect(read(setLocationHref(state, "all", []))).toEqual({ q: "pizza", remove: "tag:terrace", f: "diet:vegan", loc: "all" });
    // "Cerca mío" a mano con un barrio en el texto: el del texto se quita, así gana lo elegido.
    const palermo = [{ kind: "neighborhood", id: "PALERMO", fromText: true, fromFilter: false }];
    expect(read(setLocationHref({ q: "tragos en palermo" }, "near", palermo))).toEqual({ q: "tragos en palermo", remove: "neighborhood:PALERMO", loc: "near" });
  });

  it("buscar en esta zona reemplaza el barrio (de la barra y del texto) y conserva lo demás; la URL nunca lleva la ubicación", () => {
    const palermo = [{ kind: "neighborhood", id: "PALERMO", fromText: true, fromFilter: false }];
    const bounds = { south: -34.92049, west: -56.16051, north: -34.90012, east: -56.14001 };
    expect(read(zoneHref({ q: "tragos en palermo", intent: "bars", sub: "cocktails", f: "open:today" }, bounds, palermo))).toEqual({
      q: "tragos en palermo",
      remove: "neighborhood:PALERMO",
      intent: "bars",
      sub: "cocktails",
      f: "open:today",
      loc: "-34.921,-56.161,-34.9,-56.14",
    });
    expect(read(zoneHref(state, { south: -34.92, west: -56.16, north: -34.9, east: -56.14 }, [])).f).toBe("diet:vegan");
  });

  it("precios: reemplazan los de f, quitan los del texto no elegidos y [] es cualquier precio", () => {
    expect(read(setPricesHref({ ...state, f: "diet:vegan,price:high" }, ["low", "moderate"], []))).toEqual({
      q: "pizza",
      remove: "tag:terrace",
      f: "diet:vegan,price:low,price:moderate",
      loc: "near",
    });
    // "bar no muy caro" pide Accesible y Normal: dejar sólo Accesible quita Normal del texto.
    const noMuyCaro = [
      { kind: "price", id: "low", fromText: true, fromFilter: false },
      { kind: "price", id: "moderate", fromText: true, fromFilter: false },
    ];
    expect(read(setPricesHref({ q: "bar no muy caro" }, ["low"], noMuyCaro))).toEqual({ q: "bar no muy caro", remove: "price:moderate", f: "price:low" });
    expect(read(setPricesHref({ q: "bar no muy caro" }, [], noMuyCaro))).toEqual({ q: "bar no muy caro", remove: "price:low,price:moderate" });
    // Volver a elegir uno quitado del texto lo saca de remove.
    expect(read(setPricesHref({ q: "bar no muy caro", remove: "price:low" }, ["low"], noMuyCaro))).toEqual({ q: "bar no muy caro", remove: "price:moderate", f: "price:low" });
  });

  it("dietas: reemplazan las de f y sacar del select la del texto la quita de la búsqueda", () => {
    expect(read(setDietsHref({ q: "", f: "price:low,diet:vegetarian" }, ["vegan", "glutenFree"], []))).toEqual({ f: "price:low,diet:vegan,diet:glutenFree" });
    expect(read(setDietsHref({ q: "", f: "diet:vegan" }, [], []))).toEqual({});
    // "algo vegano": el select la muestra activa; sacarla la suma a remove, cambiarla por vegetariano también.
    const vegano = [{ kind: "diet", id: "vegan", fromText: true, fromFilter: false }];
    expect(read(setDietsHref({ q: "algo vegano" }, [], vegano))).toEqual({ q: "algo vegano", remove: "diet:vegan" });
    expect(read(setDietsHref({ q: "algo vegano" }, ["vegetarian"], vegano))).toEqual({ q: "algo vegano", remove: "diet:vegan", f: "diet:vegetarian" });
    // Sumar Sin TACC a la del texto la conserva.
    expect(read(setDietsHref({ q: "algo vegano" }, ["vegan", "glutenFree"], vegano))).toEqual({ q: "algo vegano", f: "diet:vegan,diet:glutenFree" });
  });

  it("tag de f (fila de la home): se apaga sacándolo de f", () => {
    const chip = { kind: "tag", id: "afternoon_snack", fromText: false, fromFilter: true };
    expect(read(removeChipHref({ q: "", f: "tag:afternoon_snack,diet:vegan" }, chip))).toEqual({ f: "diet:vegan" });
  });

  it("cerca mío en la URL es sólo loc=near: nunca coordenadas", () => {
    expect(setLocationHref({ q: "café" }, "near", [])).toBe("/search?q=caf%C3%A9&loc=near");
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
  const state = { q: "bares con cócteles y pizza", f: "neighborhood:CORDON,diet:vegan", loc: "near" };

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
      loc: "near",
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

describe("chips de intención de la barra: texto + intención", () => {
  const empty: BarRef = { intent: null, textIntent: null, subs: [], extras: [] };
  const f = "open:today";

  it("texto + intención: conserva el texto y no quita lo que pidió (ya no se ve como extra)", () => {
    // "salir con mi pareja" (Cita es un momento) y "pizza" (plato): elegir Cafés suma la intención y nada más.
    const bar: BarRef = { ...empty, extras: [{ kind: "prefer", id: "date", fromText: true }, { kind: "dish", id: "pizza", fromText: true }] };
    expect(read(barIntentHref({ q: "salir con mi pareja", f }, "cafes", bar))).toEqual({ q: "salir con mi pareja", intent: "cafes", f });
  });

  it("cambiar de intención con texto limpia la del texto y sus sub-filtros, pero no los extras", () => {
    const bar: BarRef = {
      intent: { id: "bars", fromText: true },
      textIntent: "bars",
      subs: [{ id: "cocktails", active: true, fromText: true, removeKeys: ["tag:classic_cocktails"] }],
      extras: [{ kind: "dish", id: "pizza", fromText: true }],
    };
    expect(read(barIntentHref({ q: "cócteles y pizza" }, "cafes", bar))).toEqual({ q: "cócteles y pizza", remove: "intent:bars,tag:classic_cocktails", intent: "cafes" });
  });

  it("apagar una intención elegida en la barra vuelve a la búsqueda sólo con el texto (y los filtros)", () => {
    const bar: BarRef = { ...empty, intent: { id: "cafes", fromText: false }, subs: [{ id: "brunch", active: true, fromText: false, removeKeys: [] }] };
    expect(read(barIntentHref({ q: "salir con mi pareja", intent: "cafes", sub: "brunch", f }, null, bar))).toEqual({ q: "salir con mi pareja", f });
  });

  it("intención sola, sin texto: elegirla y apagarla", () => {
    expect(read(barIntentHref({ q: "" }, "cafes", empty))).toEqual({ intent: "cafes" });
    expect(read(barIntentHref({ q: "", intent: "cafes" }, null, { ...empty, intent: { id: "cafes", fromText: false } }))).toEqual({});
  });

  it("texto solo: apagar la intención que eligió el texto la quita con remove", () => {
    const bar: BarRef = { ...empty, intent: { id: "cafes", fromText: true }, textIntent: "cafes" };
    expect(read(barIntentHref({ q: "cafés" }, null, bar))).toEqual({ q: "cafés", remove: "intent:cafes" });
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

  it("Ver todos de Cerca de suma nearby:1 a f (una sola vez) y su extra se apaga sacándolo", () => {
    expect(nearbyHref(state)).toBe("/search?q=salir+a+comer+con+amigos&f=neighborhood%3ACORDON%2Cnearby%3A1&debug=1");
    expect(nearbyHref({ ...state, f: "neighborhood:CORDON,nearby:1" })).toBe(nearbyHref(state));
    const chip = { kind: "nearby", id: "1", fromText: false, fromFilter: true };
    expect(removeChipHref({ ...state, f: "neighborhood:CORDON,nearby:1" }, chip)).toBe(searchHref(state));
  });

  it("widen pide la misma búsqueda a /api/search/widen, sin debug", () => {
    expect(widenUrl(state)).toBe("/api/search/widen?q=salir+a+comer+con+amigos&f=neighborhood%3ACORDON");
  });
});
