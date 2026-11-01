// Propiedades esperadas por consulta, para `yarn search:eval` y `yarn search:check` (sale con error si alguna falla).
import { isDanceOnly, isKidsNight } from "../src/server/search/fuse";
import { intentGroups, matchesGroup } from "../src/server/search/intents";
import { fitsGroup } from "../src/server/search/moments";
import type { SearchDebug, SearchResponse } from "../src/server/search/search";

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

export const CHECKS: Record<string, Check[]> = {
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
