// Propiedades esperadas por consulta, para `yarn search:eval` y `yarn search:check` (sale con error si alguna falla).
import { intentGroups, matchesGroup } from "../src/server/search/intents";
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

export const CHECKS: Record<string, Check[]> = {
  "bar con amigos": [nonEmpty, allInIntent("bars")],
  pizza: [topHaveCategory(3, "pizzeria")],
  vegano: [nonEmpty, every("todos con opciones veganas", veganOk)],
  "sin tacc": [nonEmpty, every("todos con opciones sin TACC", glutenFreeOk)],
  "algo que no sea pizza": [nonEmpty, every("ninguna pizzería", (place) => !place.categories.includes("pizzeria"))],
  "cafés en pocitos": [nonEmpty, allInIntent("cafes")],
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
