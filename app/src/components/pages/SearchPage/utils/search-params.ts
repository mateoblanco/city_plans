import { cookies } from "next/headers";
import type { SearchOptions } from "@/server/search/search";
import { LOCATION_COOKIE } from "@/lib/location";
import { parseSavedCookie, SAVED_COOKIE } from "./saved-cookie";
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
  // `near=lat,lng` viejo: cuenta como cerca mío y su coordenada se ignora (los links nuevos la reescriben como loc=near).
  const loc = firstString(params.loc)?.slice(0, 80) || (firstString(params.near) ? "near" : null);
  const intent = firstString(params.intent)?.slice(0, 50) || null;
  const sub = firstString(params.sub)?.slice(0, MAX_PARAM_LENGTH) || null;
  const debug = firstString(params.debug) === "1";
  // profile=off: la misma búsqueda sin perfil, para comparar.
  const profile = firstString(params.profile) !== "off";
  // Guardados de la cookie espejo de localStorage (la señal de gustos del perfil): se usan en este pedido y no se guardan.
  const jar = await cookies();
  const likes = parseSavedCookie(jar.get(SAVED_COOKIE)?.value);
  // Ubicación de la persona (cookie `loc`, redondeada a ~100 m; la escribe el cliente): sólo para este pedido.
  const userLocation = jar.get(LOCATION_COOKIE)?.value?.slice(0, 50) || null;
  return { query, remove, filters, loc, intent, sub, debug, profile, likes, userLocation };
}

export type Params = Awaited<ReturnType<typeof readParams>>;

/** Sin texto, filtros, ubicación elegida ni intención: no hay nada que buscar. */
export const isEmpty = ({ query, filters, loc, intent }: Params) => !query && !filters && !loc && !intent;

// key: el Suspense vuelve a mostrar su fallback en cada búsqueda nueva (refinar o quitar un chip).
// La ubicación de la cookie también: con el permiso recién dado, la misma URL es otra búsqueda.
export const searchKey = ({ query, remove, intent, sub, filters, loc, userLocation, debug, profile, likes }: Params) =>
  `${query}|${remove ?? ""}|${intent ?? ""}|${sub ?? ""}|${filters ?? ""}|${loc ?? ""}|${userLocation ?? ""}|${debug}|${profile}|${likes.join(",")}`;

/** Los parámetros como estado de la URL: base de los links de la barra y de "Reintentar". */
export const toSearchUrl = (params: Params): SearchUrl => ({
  q: params.query,
  remove: params.remove,
  intent: params.intent,
  sub: params.sub,
  f: params.filters,
  loc: params.loc,
  debug: params.debug,
  profile: params.profile,
});

/** Los parámetros como opciones de searchPlaces (q va aparte). */
export const toSearchOptions = (params: Params): SearchOptions => ({
  remove: params.remove,
  filters: params.filters,
  loc: params.loc,
  userLocation: params.userLocation,
  // /search: sin loc ni barrio, cerca mío (o pedir la ubicación). /search vacío sigue trayendo todos los publicados.
  defaultNear: !isEmpty(params),
  intent: params.intent,
  sub: params.sub,
  debug: params.debug,
  likes: params.likes,
  profile: params.profile,
});
