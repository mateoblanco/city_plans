// Propiedades esperadas por consulta, para `yarn search:eval` y `yarn search:check` (sale con error si alguna falla).
import { SEARCH_CONFIG } from "../src/server/search/config";
import { dessertFitOf, isDanceOnly, isKidsNight } from "../src/server/search/fuse";
import { intentGroups, matchesGroup } from "../src/server/search/intents";
import { fitsGroup } from "../src/server/search/moments";
import type { SearchDebug, SearchResponse } from "../src/server/search/search";
import { matchesChoice, type DiscountChoice } from "../src/server/discounts/selection";

type Place = SearchDebug["results"][number];
type Check = { description: string; test: (places: Place[], response: SearchResponse) => string[] };

const name = (place: Place) => `${place.name} [${place.categories.join(", ")}]`;
const veganOk = (place: Place) => place.diet.vegan === "has_options" || place.diet.vegan === "fully";
const glutenFreeOk = (place: Place) => place.diet.glutenFree === "has_options" || place.diet.glutenFree === "fully";

/** Lugares que no cumplen (vacío = pasa). */
const every = (description: string, ok: (place: Place) => boolean): Check => ({
  description,
  test: (places) => places.filter((place) => !ok(place)).map(name),
});

const nonEmpty: Check = { description: "hay resultados", test: (places) => (places.length ? [] : ["sin resultados"]) };

const allInIntent = (intent: "bars" | "cafes" | "eat" | "desserts"): Check => ({
  description: `intención ${intent} y todos los resultados son de ella`,
  test: (places, response) => [
    ...(response.bar.intent?.id === intent ? [] : [`intención: ${response.bar.intent?.id ?? "—"}`]),
    ...places.filter((place) => !intentGroups(intent, []).every((group) => matchesGroup(group, { ...place, featured: false }))).map(name),
  ],
});

const topHaveCategory = (count: number, category: string): Check => ({
  description: `los primeros ${count} son ${category}`,
  test: (places) => [
    ...(places.length < count ? [`sólo ${places.length} resultados`] : []),
    ...places.slice(0, count).filter((place) => !place.categories.includes(category)).map(name),
  ],
});

/** Agrupada: secciones con cada resultado una sola vez y cada grupo del catálogo con 3 a 6 lugares. */
const grouped: Check = {
  description: "agrupada en secciones, sin repetir lugares y con grupos de 3 a 6",
  test: (places, response) => {
    if (!response.sections) return [`sin secciones: ${response.debug?.sections.notGrouped ?? "—"}`];
    const ids = response.sections.flatMap((section) => section.placeIds);
    return [
      ...(new Set(ids).size === ids.length && ids.length === places.length ? [] : ["lugares repetidos o faltantes"]),
      ...response.sections.filter((section) => section.id !== "more" && (section.placeIds.length < 3 || section.placeIds.length > 6)).map((section) => `${section.id}: ${section.placeIds.length}`),
    ];
  },
};

const notGrouped: Check = { description: "sin agrupar", test: (_, response) => (response.sections ? ["tiene secciones"] : []) };

const noDanceInTop = (count: number): Check => ({
  description: `ningún boliche ni lugar sólo para bailar en los primeros ${count}`,
  test: (places) => places.slice(0, count).filter(isDanceOnly).map(name),
});

/** Sub-filtro de la intención activo y pedido por el texto (no sólo por la barra). */
const subFromText = (id: string): Check => ({
  description: `sub-filtro ${id} activo desde el texto`,
  test: (_, response) => {
    const sub = response.bar.subs.find((item) => item.id === id);
    return sub?.active && sub.fromText ? [] : [`intención ${response.bar.intent?.id ?? "—"}, ${id}: ${sub ? `active ${sub.active}, fromText ${sub.fromText}` : "no está"}`];
  },
});

/** La intención la eligió la barra (la URL), no el texto. */
const intentFromBar = (intent: string): Check => ({
  description: `intención ${intent} elegida en la barra`,
  test: (_, response) => (response.bar.intent?.id === intent && !response.bar.intent.fromText ? [] : [`intención: ${response.bar.intent?.id ?? "—"}, fromText ${response.bar.intent?.fromText ?? "—"}`]),
});

/** El texto sigue valiendo: el tag queda como preferencia de la interpretación. */
const preferTag = (id: string): Check => ({
  description: `${id} en prefer`,
  test: (_, response) => (response.debug!.interpretation.prefer.tags.includes(id) ? [] : [`prefer: ${response.debug!.interpretation.prefer.tags.join(", ") || "—"}`]),
});

/** Sub-filtro activo desde la URL (el chip de la barra). */
const subFromBar = (id: string): Check => ({
  description: `sub-filtro ${id} activo desde la barra`,
  test: (_, response) => {
    const sub = response.bar.subs.find((item) => item.id === id);
    return sub?.active && !sub.fromText ? [] : [`${id}: ${sub ? `active ${sub.active}, fromText ${sub.fromText}` : "no está"}`];
  },
});

const hasChip = (kind: string, id: string): Check => ({
  description: `chip ${kind}:${id}`,
  test: (_, response) => (response.interpreted.chips.some((chip) => chip.kind === kind && chip.id === id) ? [] : [`chips: ${response.interpreted.chips.map((chip) => `${chip.kind}:${chip.id}`).join(", ") || "—"}`]),
});

const inTop = (count: number, placeName: string): Check => ({
  description: `${placeName} en los primeros ${count}`,
  test: (places) => (places.slice(0, count).some((place) => place.name === placeName) ? [] : [`#${places.findIndex((place) => place.name === placeName) + 1 || "—"}`]),
});

/** Como every, sólo para los primeros count. */
const noneInTop = (count: number, description: string, bad: (place: Place) => boolean): Check => ({
  description: `${description} en los primeros ${count}`,
  test: (places) => places.slice(0, count).filter(bad).map(name),
});

const isMeat = (place: Place) => place.categories.includes("grill") || place.tags.includes("grilled_meat") || place.iconCategory === "grill" || place.iconCategory === "meat";

const isBar = (place: Place) => place.categories.includes("bar") || place.categories.includes("brewery");

const isFirst = (placeName: string): Check => ({
  description: `${placeName} primero`,
  test: (places) => (places[0]?.name === placeName ? [] : [`#1: ${places[0]?.name ?? "—"}; ${placeName}: #${places.findIndex((place) => place.name === placeName) + 1 || "—"}`]),
});

const SUNSET_TAGS = ["sea_view", "rooftop", "terrace"];

/** Los primeros count cumplen ok (y hay al menos count resultados). */
const topAll = (count: number, description: string, ok: (place: Place) => boolean): Check => ({
  description: `los primeros ${count} ${description}`,
  test: (places) => [...(places.length < count ? [`sólo ${places.length} resultados`] : []), ...places.slice(0, count).filter((place) => !ok(place)).map(name)],
});

/** Lugar de postres: heladería, o ícono de postre o helado (dessertFit entero). */
const isDessertPlace = (place: Place) => dessertFitOf(place) === SEARCH_CONFIG.boosts.dessertFit;

const hasDiscount = (place: Place, choices: DiscountChoice[]) => place.discounts.some((discount) => choices.some((choice) => matchesChoice(discount, choice)));

/** Filtro de descuentos: todos cumplen alguna elección (un beneficio "other" cumple débito y crédito). */
const allWithDiscount = (choices: DiscountChoice[]): Check =>
  every(`todos con descuento ${choices.map((choice) => `${choice.provider} ${choice.card}`).join(" o ")}`, (place) => hasDiscount(place, choices));

/** La línea "Descuento: …" de cada card dice sólo lo elegido (por id de proveedor, en este orden). */
const cardDiscountsAre = (ids: string[]): Check => ({
  description: `la card muestra sólo los descuentos ${ids.join(", ")}`,
  test: (_, response) =>
    response.results
      .filter((result) => result.discounts.map((discount) => discount.id).join() !== ids.join())
      .map((result) => `${result.name}: ${result.discounts.map((discount) => discount.id).join(", ") || "—"}`),
});

const noDiscountGroups: Check = {
  description: "sin grupos por proveedor de descuento",
  test: (_, response) => (response.sections ?? []).filter((section) => section.id.startsWith("discount:")).map((section) => section.title),
};

/** Con 2 o más proveedores: un grupo por proveedor, en este orden, cada lugar cumple su proveedor y un lugar con varios va en cada uno. */
const discountGroups = (choices: DiscountChoice[], order: string[]): Check => ({
  description: `agrupada por proveedor: ${order.join(", ")}; un lugar con varios en cada grupo`,
  test: (places, response) => {
    const sections = response.sections ?? [];
    const byId = new Map(places.map((place) => [place.id, place]));
    const problems = sections.map((section) => section.id).join() === order.map((id) => `discount:${id}`).join() ? [] : [`grupos: ${sections.map((section) => section.id).join(", ") || "—"}`];
    for (const section of sections) {
      const own = choices.filter((choice) => `discount:${choice.provider}` === section.id);
      for (const id of section.placeIds) if (!hasDiscount(byId.get(id)!, own)) problems.push(`${section.id}: ${byId.get(id)?.name}`);
      const expected = places.filter((place) => hasDiscount(place, own)).slice(0, section.placeIds.length).map((place) => place.id);
      if (expected.join() !== section.placeIds.join()) problems.push(`${section.id}: no son los primeros que cumplen`);
    }
    return problems;
  },
});

const includesPlace = (placeName: string): Check => ({
  description: `${placeName} está`,
  test: (places) => (places.some((place) => place.name === placeName) ? [] : ["no está"]),
});

/** Chip con su origen: del texto, de la barra (f) o de los dos. */
const chipFrom = (kind: string, id: string, from: { fromText: boolean; fromFilter: boolean }): Check => ({
  description: `chip ${kind}:${id} ${from.fromText ? "del texto" : ""}${from.fromText && from.fromFilter ? " y " : ""}${from.fromFilter ? "de la barra" : ""}`.trim(),
  test: (_, response) => {
    const chip = response.interpreted.chips.find((item) => item.kind === kind && item.id === id);
    if (!chip) return [`chips: ${response.interpreted.chips.map((item) => `${item.kind}:${item.id}`).join(", ") || "—"}`];
    return Boolean(chip.fromText) === from.fromText && Boolean(chip.fromFilter) === from.fromFilter ? [] : [`fromText ${chip.fromText}, fromFilter ${chip.fromFilter}`];
  },
});

/**
 * Clave de CHECKS: el texto y, opcional, los parámetros de la URL después de " ?" ("cafés ?f=diet:glutenFree",
 * " ?f=diet:vegan" sin texto). Pisan los --f, --intent y --sub de la línea de comandos.
 */
export function parseCheckKey(key: string): { query: string; filters?: string | null; intent?: string | null; sub?: string | null } {
  const index = key.indexOf(" ?");
  if (index === -1) return { query: key };
  const params = new URLSearchParams(key.slice(index + 2));
  return { query: key.slice(0, index).trim(), filters: params.get("f"), intent: params.get("intent"), sub: params.get("sub") };
}

export const CHECKS: Record<string, Check[]> = {
  "Bar Tasende": [isFirst("Bar Tasende")],
  // Sin texto, la intención y el sub-filtro ordenan por afinidad (dessertFit, subFit).
  " ?intent=desserts": [allInIntent("desserts"), topAll(5, "son heladerías o pastelerías (heladería o ícono de postre)", isDessertPlace)],
  " ?intent=bars&sub=cocktails": [allInIntent("bars"), subFromBar("cocktails"), topAll(5, "tienen signature_cocktails", (place) => place.tags.includes("signature_cocktails"))],
  Jacinto: [isFirst("Jacinto")],
  Abasto: [isFirst("Abasto")],
  "La Latina Café": [isFirst("La Latina Café")],
  "algo para ir con mis viejos": [
    nonEmpty,
    {
      description: "sin kids_friendly en la interpretación",
      test: (_, response) => {
        const { must, prefer } = response.debug!.interpretation;
        return [...must.tags, ...prefer.tags].includes("kids_friendly") ? [`must: ${must.tags.join(", ") || "—"}; prefer: ${prefer.tags.join(", ") || "—"}`] : [];
      },
    },
    noneInTop(10, "ninguno con dj o dancing ni bar nocturno (late_night sin restaurant)", isKidsNight),
  ],
  "lugar para ver el atardecer": [
    nonEmpty,
    {
      description: "ningún watch_football en los primeros 5 por keyword",
      test: (_, response) => {
        const debug = response.debug!;
        return debug.rankings.keyword.slice(0, 5).filter((entry) => debug.results.find((place) => place.id === entry.id)?.tags.includes("watch_football")).map((entry) => entry.name);
      },
    },
    {
      description: "al menos 3 de los primeros 10 con vista al mar, azotea o terraza",
      test: (places) => {
        const top = places.slice(0, 10);
        const fit = top.filter((place) => place.tags.some((tag) => SUNSET_TAGS.includes(tag)));
        return fit.length >= 3 ? [] : [`${fit.length} de ${top.length}: ${fit.map(name).join("; ") || "—"}`];
      },
    },
  ],
  "café lindo con plantas": [nonEmpty, noneInTop(3, "ni Plaza Café ni Planta Baja", (place) => place.name === "Plaza Café" || place.name === "Planta Baja")],
  "para ir con amigos": [
    nonEmpty,
    {
      description: "groups en prefer y no en must",
      test: (_, response) => {
        const { must, prefer } = response.debug!.interpretation;
        return prefer.tags.includes("groups") && !must.tags.includes("groups") ? [] : [`prefer: ${prefer.tags.join(", ") || "—"}; must: ${must.tags.join(", ") || "—"}`];
      },
    },
    {
      description: "al menos 7 de los primeros 10 son bares, cervecerías o lugares con señales de grupo",
      test: (places) => {
        const top = places.slice(0, 10);
        const others = top.filter((place) => !isBar(place) && !fitsGroup(place));
        return top.length === 10 && others.length <= 3 ? [] : [`${top.length - others.length} de ${top.length}; no cumplen: ${others.map(name).join("; ") || "—"}`];
      },
    },
  ],
  "comer con amigos": [nonEmpty, allInIntent("eat"), noDanceInTop(5), every("ningún lugar que sea sólo cafetería (cafe sin restaurante ni bar)", (place) => !place.categories.includes("cafe") || place.categories.includes("restaurant") || place.categories.includes("bar")), grouped],
  "tomar algo con amigos": [nonEmpty, allInIntent("bars"), noDanceInTop(5), grouped],
  "bar con amigos": [nonEmpty, allInIntent("bars")],
  pizza: [topHaveCategory(3, "pizzeria"), notGrouped],
  vegano: [nonEmpty, every("todos con opciones veganas", veganOk)],
  "sin tacc": [nonEmpty, every("todos con opciones sin TACC", glutenFreeOk)],
  // Dieta del select de la barra, sin texto: la misma búsqueda que el chip "Vegano" de la home.
  " ?f=diet:vegan": [nonEmpty, chipFrom("diet", "vegan", { fromText: false, fromFilter: true }), every("todos con opciones veganas", veganOk)],
  // Dieta desde el texto: el select la muestra activa por el chip del texto.
  "sin gluten": [nonEmpty, chipFrom("diet", "glutenFree", { fromText: true, fromFilter: false }), every("todos con opciones sin TACC", glutenFreeOk)],
  "cafés ?f=diet:glutenFree": [nonEmpty, allInIntent("cafes"), chipFrom("diet", "glutenFree", { fromText: false, fromFilter: true }), every("todos con opciones sin TACC", glutenFreeOk)],
  "algo que no sea pizza": [nonEmpty, every("ninguna pizzería", (place) => !place.categories.includes("pizzeria"))],
  "cafés en pocitos": [nonEmpty, allInIntent("cafes")],
  "almorzar en Ciudad Vieja": [nonEmpty, subFromText("lunch"), hasChip("neighborhood", "CIUDAD VIEJA"), topHaveCategory(5, "restaurant")],
  "algo barato para cenar": [
    nonEmpty,
    subFromText("dinner"),
    { description: "precio pedido low", test: (_, response) => (JSON.stringify(response.debug?.interpretation.must.price) === '["low"]' ? [] : [`must.price: ${JSON.stringify(response.debug?.interpretation.must.price)}`]) },
    every("todos con precio Accesible", (place) => place.price === "low"),
  ],
  "un café acogedor": [nonEmpty, allInIntent("cafes"), topHaveCategory(10, "cafe")],
  "con niños": [
    nonEmpty,
    inTop(3, "Café Kids"),
    noneInTop(10, "ninguno con dj o dancing ni bar nocturno (late_night sin restaurant)", isKidsNight),
    { description: "sin grupo de bares", test: (_, response) => (response.sections ?? []).filter((section) => section.id === "drinks").map((section) => section.title) },
  ],
  "pizza a la leña": [nonEmpty, every("todos con horno a leña", (place) => place.tags.includes("wood_fired_oven")), topHaveCategory(3, "pizzeria")],
  "comer carne": [
    nonEmpty,
    { description: "el primero no es un café", test: (places) => (places[0] && places[0].categories.includes("cafe") ? [name(places[0])] : []) },
    { description: "los primeros 5 son de parrilla o carne", test: (places) => places.slice(0, 5).filter((place) => !isMeat(place)).map(name) },
  ],
  "algo sin carne": [nonEmpty, noneInTop(10, "ninguna parrilla ni carne", isMeat)],
  // Descuentos de la barra, sin texto: un proveedor y crédito; dos proveedores (grupos); "other" cumple débito y crédito.
  " ?f=discount:itau.credit": [nonEmpty, allWithDiscount([{ provider: "itau", card: "credit" }]), cardDiscountsAre(["itau"]), noDiscountGroups],
  " ?f=discount:itau.credit,discount:itau-personal-bank.debit": [
    nonEmpty,
    allWithDiscount([{ provider: "itau", card: "credit" }, { provider: "itau-personal-bank", card: "debit" }]),
    discountGroups([{ provider: "itau", card: "credit" }, { provider: "itau-personal-bank", card: "debit" }], ["itau", "itau-personal-bank"]),
    // La Perdiz tiene Itaú crédito e Itaú Personal Bank débito: cuenta para los dos grupos (discountGroups verifica que
    // cada grupo tome los primeros que cumplen, así que va en cada uno si le alcanza el puesto).
    {
      description: "La Perdiz está y cumple los dos proveedores",
      test: (places) => {
        const perdiz = places.find((place) => place.name === "La Perdiz");
        if (!perdiz) return ["no está"];
        return hasDiscount(perdiz, [{ provider: "itau", card: "credit" }]) && hasDiscount(perdiz, [{ provider: "itau-personal-bank", card: "debit" }]) ? [] : ["no cumple los dos"];
      },
    },
  ],
  " ?f=discount:santander.debit": [nonEmpty, allWithDiscount([{ provider: "santander", card: "debit" }]), includesPlace("Café Butiá")],
  " ?f=discount:santander.credit": [nonEmpty, allWithDiscount([{ provider: "santander", card: "credit" }]), includesPlace("Café Butiá")],
  // Texto + intención (los chips de la home y de la barra): la intención de la URL se combina con el texto, que sigue
  // valiendo entero; intención sola sin texto; el texto solo.
  " ?intent=cafes": [nonEmpty, intentFromBar("cafes"), allInIntent("cafes")],
  " ?intent=cafes&sub=brunch": [nonEmpty, allInIntent("cafes"), subFromBar("brunch"), every("todos con brunch", (place) => place.tags.includes("brunch"))],
  "salir con mi pareja ?intent=cafes": [nonEmpty, intentFromBar("cafes"), allInIntent("cafes"), preferTag("date")],
  "salir con mi pareja": [nonEmpty, preferTag("date")],
  "Mercado del Puerto": [
    nonEmpty,
    hasChip("venue", "Mercado del Puerto"),
    { description: "dentro del venue o su radio (sin relajarlo)", test: (_, response) => response.relaxed.filter((notice) => notice.what === "venue" || notice.what === "similarity").map((notice) => notice.message) },
    every("todos en Ciudad Vieja", (place) => place.neighborhoodId === "CIUDAD VIEJA"),
  ],
};

/** Corre las verificaciones de una consulta; devuelve las fallas ("descripción: lugares"). */
export function runChecks(query: string, response: SearchResponse): { passed: string[]; failed: string[] } {
  const debug = response.debug!;
  const places = response.results.map((result) => debug.results.find((entry) => entry.id === result.id)!);
  const passed: string[] = [];
  const failed: string[] = [];
  for (const check of CHECKS[query] ?? []) {
    const problems = check.test(places, response);
    if (problems.length) failed.push(`${check.description}: ${problems.join("; ")}`);
    else passed.push(check.description);
  }
  return { passed, failed };
}
