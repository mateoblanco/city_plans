import type { SearchOptions } from "@/server/search/search";
import type { SearchUrl } from "./search-href";

/** Parámetros de /search: los leen el header (input y barra) y los resultados. */
export type SearchParams = PageProps<"/search">["searchParams"];

const MAX_PARAM_LENGTH = 500;

const firstString = (value: string | string[] | undefined) => (typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined);

export async function readParams(searchParams: SearchParams) {
  const params = await searchParams;
  const query = (firstString(params.q) ?? "").trim().slice(0, MAX_PARAM_LENGTH);
  const remove = firstString(params.remove)?.slice(0, MAX_PARAM_LENGTH) || null;
  const filters = firstString(params.f)?.slice(0, MAX_PARAM_LENGTH) || null;
  const near = firstString(params.near)?.slice(0, 50) || null;
  const intent = firstString(params.intent)?.slice(0, 50) || null;
  const sub = firstString(params.sub)?.slice(0, MAX_PARAM_LENGTH) || null;
  const debug = firstString(params.debug) === "1";
  return { query, remove, filters, near, intent, sub, debug };
}

export type Params = Awaited<ReturnType<typeof readParams>>;

/** Sin texto, filtros ni intención: no hay nada que buscar. */
export const isEmpty = ({ query, filters, near, intent }: Params) => !query && !filters && !near && !intent;

// key: el Suspense vuelve a mostrar su fallback en cada búsqueda nueva (refinar o quitar un chip).
export const searchKey = ({ query, remove, intent, sub, filters, near, debug }: Params) =>
  `${query}|${remove ?? ""}|${intent ?? ""}|${sub ?? ""}|${filters ?? ""}|${near ?? ""}|${debug}`;

/** Los parámetros como estado de la URL: base de los links de la barra y de "Reintentar". */
export const toSearchUrl = (params: Params): SearchUrl => ({
  q: params.query,
  remove: params.remove,
  intent: params.intent,
  sub: params.sub,
  f: params.filters,
  near: params.near,
  debug: params.debug,
});

/** Los parámetros como opciones de searchPlaces (q va aparte). */
export const toSearchOptions = (params: Params): SearchOptions => ({
  remove: params.remove,
  filters: params.filters,
  near: params.near,
  intent: params.intent,
  sub: params.sub,
  debug: params.debug,
});
