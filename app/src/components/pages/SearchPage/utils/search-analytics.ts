import { normalize } from "@shared/tags.ts";
import type { SearchResponse } from "@/server/search";
import { parseLocationCookie } from "@/lib/location";
import { QUERY_MAX, type ActiveFilters } from "@/lib/product-analytics/events";
import type { Params } from "./search-params";

/** Lo que search_submitted manda de una búsqueda, salvo el origen (lo pone el cliente: depende de qué la disparó). */
export type SearchSummary = {
  query: string;
  query_normalized: string;
  tab: string;
  filters: ActiveFilters;
  results_count: number;
  resolved_by: SearchResponse["resolvedBy"];
  has_location: boolean;
};

const unique = (values: string[]) => [...new Set(values)];

/**
 * Los filtros activos de la búsqueda, por tipo. La ubicación va sólo como tipo (`near`, `all`, `zone`) o con los
 * barrios: nunca coordenadas, zona ni radio. Precio, dieta y horario salen de los chips (también lo que detectó el
 * texto); descuentos, de `f`.
 */
export function activeFilters(response: SearchResponse, params: Pick<Params, "filters">): ActiveFilters {
  const chips = response.interpreted.chips;
  const of = (kind: string) => unique(chips.filter((chip) => chip.kind === kind).map((chip) => chip.id));
  const location = response.location.kind === "neighborhood" ? of("neighborhood").map((id) => `neighborhood:${id}`) : [response.location.kind];
  const discounts = (params.filters ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("discount:"))
    .map((part) => part.slice("discount:".length));
  const filters: ActiveFilters = {
    location,
    price: of("price"),
    diet: of("diet"),
    open: of("openAt"),
    discount: unique(discounts),
    sub: response.bar.subs.filter((sub) => sub.active).map((sub) => sub.id),
    extra: unique(response.bar.extras.filter((chip) => chip.fromFilter).map((chip) => `${chip.kind}:${chip.id}`)),
  };
  return Object.fromEntries(Object.entries(filters).filter(([, values]) => values.length > 0));
}

/** El resumen de una búsqueda para la analítica de producto (sin ubicación de la persona: sólo si había). */
export function searchSummary(response: SearchResponse, params: Pick<Params, "query" | "filters" | "userLocation">): SearchSummary {
  return {
    query: params.query.slice(0, QUERY_MAX),
    query_normalized: normalize(params.query).slice(0, QUERY_MAX),
    tab: response.bar.intent?.id ?? "all",
    filters: activeFilters(response, params),
    results_count: response.results.length + (response.nearby && !response.nearbyOnly ? response.nearby.total : 0),
    resolved_by: response.resolvedBy,
    has_location: parseLocationCookie(params.userLocation)?.kind === "coords",
  };
}
