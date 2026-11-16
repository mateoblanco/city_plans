import { sectionDef } from "@shared/sections.ts";
import type { Params } from "@/components/pages/SearchPage/utils/search-params";
import { buildChips, type Chip } from "@/server/search/chips";
import { applyFilters, filterChipKeys, parseFilters } from "@/server/search/filters";
import { montevideoNow } from "@/server/search/hours";
import { buildBar, parseIntent, resolveIntent, type IntentBar } from "@/server/search/intents";
import { emptyInterpretation } from "@/server/search/interpretation";
import { DISPLAY_LANG } from "@/server/search/labels";
import { parseLocationChoice, parseLocationCookie, resolveLocation, type SearchLocation } from "@/server/search/location";
import { nearbyTitle } from "@/server/search/nearby";

export type ProvisionalBar = {
  chips: Chip[];
  bar: IntentBar;
  location: SearchLocation;
  /** Hay texto y la URL no pide intención: el texto puede traer una, con sus sub-filtros (van skeletons). */
  pendingSubs: boolean;
};

/**
 * La barra mientras llega la búsqueda, sólo con la URL (y la cookie de ubicación): lo activo de `f`, `loc` e `intent`/
 * `sub`, con las mismas funciones que usa la búsqueda (buildChips, resolveIntent, buildBar, resolveLocation) pero sin el
 * texto, que necesita el modelo. Lo que detecte el texto ("vegano en Palermo") se marca cuando llega la respuesta.
 */
export function provisionalBar(params: Params, now = new Date()): ProvisionalBar {
  const filters = parseFilters(params.filters);
  const filterKeys = filterChipKeys(filters);
  const interpretation = applyFilters(emptyInterpretation(), filters);
  const chips = buildChips(interpretation, montevideoNow(now).day).map((chip) => ({
    ...chip,
    fromText: false,
    fromFilter: filterKeys.has(`${chip.kind}:${chip.id}`),
  }));

  const url = parseIntent(params.intent, params.sub);
  const resolved = resolveIntent(interpretation, url, []);
  // Los extras que vienen de `f`, como en la búsqueda: el tag de una fila de la home, el "Ver todos" de un grupo y el de
  // "Cerca de <barrio>".
  const extras: Chip[] = chips.filter((chip) => chip.kind === "tag" && chip.fromFilter);
  if (filters.section) extras.push({ kind: "section", id: filters.section, label: sectionDef(filters.section).title[DISPLAY_LANG], fromText: false, fromFilter: true });
  if (filters.nearby && filters.neighborhoods.length) extras.push({ kind: "nearby", id: "1", label: nearbyTitle(filters.neighborhoods), fromText: false, fromFilter: true });

  const location = resolveLocation({
    choice: parseLocationChoice(params.loc),
    user: parseLocationCookie(params.userLocation),
    // Como /search con algo que buscar (searchOptions): sin elección, cerca mío.
    defaultNear: true,
    neighborhoods: filters.neighborhoods,
    venues: [],
    pinned: false,
    textNear: false,
  });

  return { chips, bar: buildBar(resolved, extras), location, pendingSubs: Boolean(params.query) && url.intent === null };
}
