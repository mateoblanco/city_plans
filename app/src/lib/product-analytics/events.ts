/**
 * Tracking plan de la analítica de producto (Mixpanel): los únicos eventos y propiedades que se pueden mandar. El
 * documento para personas es `app/docs/tracking-plan.md`; si cambia algo acá, cambia allá (y, si es un dato nuevo, la
 * Política de privacidad). Nunca la ubicación de la persona (coordenadas, distancia, "cerca mío" con radio) ni sus
 * guardados: `sanitize` (track.ts) los saca aunque alguien los pase, y `events.test.ts` falla si una propiedad se llama así.
 * Puro: lo usan los server components (atributos `data-pa`) y el cliente.
 */

/**
 * Cómo empezó la búsqueda (search_submitted). Ninguno coincide con un valor de `tab` (all, eat, bars, cafes, desserts).
 * `filter` e `intent_tab` sólo aparecen al llegar a /search desde otra página (los filtros y las pestañas de la home):
 * dentro de /search, cambiar un filtro o una pestaña no es una búsqueda nueva (filter_changed, intent_tab_selected).
 */
export const SEARCH_ORIGINS = ["search_bar", "dish", "home_row", "link", "guide", "filter", "intent_tab"] as const;
export type SearchOrigin = (typeof SEARCH_ORIGINS)[number];

/** Orígenes que siempre son una búsqueda nueva, aunque ya se esté en /search (otro texto en el buscador). */
export const NEW_SEARCH_ORIGINS: ReadonlySet<SearchOrigin> = new Set(["search_bar", "dish", "home_row", "guide"]);

/** Quién interpretó el texto (`InterpretationSource` de server/search/search.ts, con `shortcut` → `dictionary`). */
export const RESOLVED_BY = ["dictionary", "llm", "name", "fallback", "filters"] as const;
export type ResolvedBy = (typeof RESOLVED_BY)[number];

export const PAGE_TYPES = ["home", "search", "place", "guide", "guides_city", "legal", "other"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const SHARE_METHODS = ["native", "copy", "whatsapp"] as const;
export type ShareMethod = (typeof SHARE_METHODS)[number];

export const EXTERNAL_LINKS = ["instagram", "web", "whatsapp", "phone"] as const;
export type ExternalLink = (typeof EXTERNAL_LINKS)[number];

export const RESULT_SURFACES = ["list", "map"] as const;
export type ResultSurface = (typeof RESULT_SURFACES)[number];

/** Los filtros de la barra de /search. `location` va sólo como tipo (`near`, `all`, `zone`, `neighborhood`). */
export const FILTER_KEYS = ["location", "price", "diet", "discount", "open", "sub", "extra", "section"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Lo que tiene activo una búsqueda, por filtro (sin coordenadas ni radio: la ubicación es sólo su tipo). */
export type ActiveFilters = Partial<Record<FilterKey, string[]>>;

/** Origen de la ficha: el de la popularidad propia (`@shared/events.ts`). */
export type PlaceOrigin = "search" | "home" | "saved" | "similar" | "branch" | "direct" | "guide";

type SearchProps = {
  /** El texto, recortado a 100 caracteres. Vacío si se buscó sólo con filtros. */
  query: string;
  /**
   * El mismo texto normalizado, para agrupar búsquedas iguales: minúsculas, sin tildes (también la de la ñ: "año" →
   * "ano"), sin espacios repetidos ni en las puntas (`normalize` de shared/tags.ts). Máximo 100.
   */
  query_normalized: string;
  origin: SearchOrigin;
  /** La intención activa (`eat`, `bars`…) o `all`. */
  tab: string;
  filters: ActiveFilters;
  results_count: number;
  resolved_by: ResolvedBy | null;
  /** Si la búsqueda usó la ubicación de la persona (sí/no; nunca cuál). */
  has_location: boolean;
};

type PlaceRef = { place_id: string; slug: string };

export type ProductEvents = {
  /**
   * El page view nativo de Mixpanel: sale como `$mp_web_page_view` (track_pageview), con current_url_path,
   * current_domain y current_page_title, que agrega Mixpanel (sin current_url_search: ver BLOCKED_PROPERTIES).
   */
  page_view: { page_type: PageType };

  search_submitted: SearchProps;
  search_no_results: SearchProps;
  filter_changed: { filter: FilterKey; value: string };
  intent_tab_selected: { tab: string };
  search_result_clicked: PlaceRef & { position: number; surface: ResultSurface; query: string };
  map_zone_search: Record<string, never>;
  /** Scroll infinito: se suma la página siguiente. visible_count: las cards que ya se veían. */
  results_load_more: { visible_count: number; total_count: number; page: number };
  /** Un marcador del mapa de /search (antes de abrir la ficha). position: el puesto en el ranking. */
  map_marker_clicked: PlaceRef & { position: number };
  /** Quitar un chip activo de la barra (el horario, un sub-filtro o un extra). from_text: lo había puesto el texto. */
  chip_removed: { filter: FilterKey; chip: string; from_text: boolean };

  place_viewed: PlaceRef & { origin: PlaceOrigin; row: string | null };
  place_saved: PlaceRef & { origin: PlaceOrigin };
  place_unsaved: PlaceRef & { origin: PlaceOrigin };
  directions_clicked: PlaceRef;
  share_clicked: PlaceRef & { method: ShareMethod };
  external_link_clicked: PlaceRef & { link: ExternalLink };
  discount_info_clicked: PlaceRef & { bank: string };

  home_row_clicked: PlaceRef & { row: string; position: number };
  home_see_all_clicked: { row: string };
  dish_clicked: { dish: string };
  guide_viewed: { guide: string };
  guide_place_clicked: PlaceRef & { guide: string; position: number };

  location_permission: { result: "granted" | "denied" };
  welcome_completed: { cards: string[] };
  welcome_skipped: { step: "cards" | "places" };
};

export type ProductEvent = keyof ProductEvents;

export const PRODUCT_EVENTS = [
  "page_view",
  "search_submitted",
  "search_no_results",
  "filter_changed",
  "intent_tab_selected",
  "search_result_clicked",
  "map_zone_search",
  "results_load_more",
  "map_marker_clicked",
  "chip_removed",
  "place_viewed",
  "place_saved",
  "place_unsaved",
  "directions_clicked",
  "share_clicked",
  "external_link_clicked",
  "discount_info_clicked",
  "home_row_clicked",
  "home_see_all_clicked",
  "dish_clicked",
  "guide_viewed",
  "guide_place_clicked",
  "location_permission",
  "welcome_completed",
  "welcome_skipped",
] as const satisfies readonly ProductEvent[];

/** Máximo del texto de búsqueda que se manda. */
export const QUERY_MAX = 100;
