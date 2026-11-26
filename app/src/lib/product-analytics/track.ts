import { isBot } from "@/lib/bots";
import { QUERY_MAX, type ProductEvent, type ProductEvents, type SearchOrigin } from "./events";

/**
 * Analítica de producto (Mixpanel) del lado del navegador. Este módulo es chico y se carga siempre (lo importan los
 * botones); la librería de Mixpanel es otro chunk (load.ts) que se pide recién cuando ProductAnalytics la prende, después
 * del `load` y con el navegador libre. Hasta entonces los eventos esperan en una cola en memoria. Apagado (desarrollo,
 * previews, bots), `track` no hace nada y Mixpanel nunca se baja. Todo vive en memoria del módulo: sobrevive a la
 * navegación interna de Next, no a una recarga.
 */
export type Mode = "off" | "send" | "debug";
// `pending` hasta que ProductAnalytics decide: los efectos de las páginas (place_viewed, guide_viewed) corren antes que
// el del layout, así que se encolan. Si la analítica está apagada el componente no se monta y la cola queda en memoria
// (tope QUEUE_MAX), sin enviarse nunca.
type State = Mode | "pending";
export type Client = {
  track: (event: string, props: Record<string, unknown>) => void;
  /** El page view nativo de Mixpanel (`$mp_web_page_view`). */
  pageView: (props: Record<string, unknown>) => void;
};

const QUEUE_MAX = 50;

let mode: State = "pending";
let client: Client | null = null;
let queue: { event: string; props: Record<string, unknown> }[] = [];
// Origen de la próxima búsqueda: lo marca lo que la dispara (barra, plato, fila, guía, filtro, pestaña, zona).
let searchOrigin: SearchOrigin | null = null;

/** Claves que nunca salen: ubicación de la persona y sus guardados. Defensa además de los tipos de events.ts. */
export const FORBIDDEN_KEY = /^(lat|lng|lon|latitude|longitude|coords?|coordinates|geo|distance(_m|_km)?|near|user_?location|saved(_places)?|likes)$/i;

/** Saca las claves prohibidas y recorta el texto de búsqueda. */
export function sanitize(props: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY.test(key) || value === undefined) continue;
    clean[key] = (key === "query" || key === "query_normalized") && typeof value === "string" ? value.slice(0, QUERY_MAX) : value;
  }
  return clean;
}

/** Un navegador automatizado o un bot: no se mide (Lighthouse, Puppeteer, Playwright, crawlers). */
export const isAutomated = (nav: Pick<Navigator, "userAgent" | "webdriver">) => nav.webdriver === true || isBot(nav.userAgent);

/** Lo prende ProductAnalytics (sólo con modo `send` o `debug` y fuera de bots). Los eventos esperan hasta `attach`. */
export function enableProductAnalytics(next: Exclude<Mode, "off">) {
  mode = next;
}

/** Bots y navegadores automatizados: se descarta la cola y no se mide nada más. */
export function disableProductAnalytics() {
  mode = "off";
  queue = [];
}

/** La librería ya cargó: manda lo que estaba en la cola. */
export function attach(next: Client) {
  client = next;
  const pending = queue;
  queue = [];
  for (const item of pending) send(item.event, item.props);
}

function send(event: string, props: Record<string, unknown>) {
  try {
    if (event === "page_view") client?.pageView(props);
    else client?.track(event, props);
  } catch {
    // Nunca afecta a la página.
  }
}

/** Eventos que llevan a una búsqueda: marcan su origen para el search_submitted que sigue. */
const SEARCH_ORIGIN_OF: Partial<Record<ProductEvent, SearchOrigin>> = {
  dish_clicked: "dish",
  home_see_all_clicked: "home_row",
  filter_changed: "filter",
  chip_removed: "filter",
  intent_tab_selected: "tab",
  map_zone_search: "zone",
};

/** Manda un evento del tracking plan. Nunca espera ni tira error; apagado, no hace nada. */
export function track<E extends ProductEvent>(event: E, props: ProductEvents[E]) {
  const origin = SEARCH_ORIGIN_OF[event];
  if (origin) searchOrigin = origin;
  if (mode === "off") return;
  const clean = sanitize(props as Record<string, unknown>);
  if (client) send(event, clean);
  else if (queue.length < QUEUE_MAX) queue.push({ event, props: clean });
}

/**
 * Para los clicks de server components (links que no son de cliente): atributos que lee el listener de ProductAnalytics
 * (`clickTarget`). Tipado igual que `track`.
 */
export function trackAttrs<E extends ProductEvent>(event: E, props: ProductEvents[E]) {
  return { "data-pa": event, "data-pa-props": JSON.stringify(props) };
}

/**
 * El evento de un click: el link o botón tocado y, de él hacia arriba, el elemento con `data-pa` más cercano (puede ser
 * el mismo link o un contenedor, como el encabezado de una fila con su título y su flecha). Un click fuera de un link o
 * botón no cuenta.
 */
export function clickTarget(target: EventTarget | null): { event: ProductEvent; props: Record<string, unknown> } | null {
  const action = target && typeof (target as Element).closest === "function" ? (target as Element).closest("a, button") : null;
  const element = action?.closest("[data-pa]");
  const event = element?.getAttribute("data-pa");
  if (!element || !event) return null;
  try {
    return { event: event as ProductEvent, props: JSON.parse(element.getAttribute("data-pa-props") ?? "{}") };
  } catch {
    return null;
  }
}

// El texto de la búsqueda que se está mostrando (search_result_clicked).
let currentQuery = "";

/** La lista de una búsqueda se mostró (useTrackSearch). */
export function setCurrentSearchQuery(query: string) {
  currentQuery = query;
}

export const currentSearchQuery = () => currentQuery;

/** Antes de navegar a una búsqueda: de dónde sale. */
export function markSearchOrigin(origin: SearchOrigin) {
  searchOrigin = origin;
}

/** Al terminar la búsqueda: el origen marcado (una sola vez) o `link` (URL directa, recarga, atrás). */
export function takeSearchOrigin(): SearchOrigin {
  const origin = searchOrigin ?? "link";
  searchOrigin = null;
  return origin;
}

/** Para los tests. */
export function resetProductAnalytics() {
  mode = "pending";
  client = null;
  queue = [];
  searchOrigin = null;
  currentQuery = "";
}
