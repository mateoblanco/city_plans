import type { SearchResponse, SearchResult } from "@/server/search";
import type { MapPlace } from "../Results/Map/SearchMap/SearchMap";

/** Cuántas cards suma cada página del scroll infinito (y cuántas se ven de entrada en la lista o en "Más opciones"). */
export const PAGE_SIZE = 12;

/** total: cuántos cumplen la regla del grupo, para decidir si tiene "Ver todos"; null sin "Ver todos". */
export type VisibleSection = { id: string; title: string; places: SearchResult[]; total: number | null };

export type ResultsPage = {
  /** Sin grupos: la fila "Para vos" (perfil), arriba de la lista; null sin fila. */
  forYou: VisibleSection | null;
  /** Sin grupos: la lista hasta la página pedida, sin los de "Para vos". Con grupos, null. */
  list: SearchResult[] | null;
  /** Con grupos: cada grupo completo (el servidor ya los corta en maxPlaces) y "Más opciones" hasta la página pedida. */
  sections: VisibleSection[] | null;
  /** Quedan cards por sumar (en la lista o en "Más opciones"); si no, se llegó al final. */
  hasMore: boolean;
  /** Todas las cards visibles, en orden: lo que muestra el mapa. */
  places: SearchResult[];
};

/**
 * Lo que se ve con `pages` páginas: la respuesta trae la lista completa, así que el scroll infinito no vuelve a buscar.
 * Sin grupos pagina la lista; con grupos, sólo "Más opciones".
 */
export function visiblePage(response: Pick<SearchResponse, "results" | "sections" | "forYou">, pages: number): ResultsPage {
  const limit = PAGE_SIZE * pages;
  const byId = new Map(response.results.map((place) => [place.id, place]));
  if (!response.sections) {
    // "Para vos" va arriba y no se repite en la lista; el resto de la lista no cambia.
    const forYouIds = new Set(response.forYou?.placeIds ?? []);
    const forYou = response.forYou
      ? { id: response.forYou.id, title: response.forYou.title, places: response.forYou.placeIds.flatMap((id) => byId.get(id) ?? []), total: null }
      : null;
    const rest = response.results.filter((place) => !forYouIds.has(place.id));
    const list = rest.slice(0, limit);
    return { forYou, list, sections: null, hasMore: rest.length > list.length, places: [...(forYou?.places ?? []), ...list] };
  }
  let hasMore = false;
  const sections = response.sections.map((section): VisibleSection => {
    const all = section.placeIds.flatMap((id) => byId.get(id) ?? []);
    const places = section.id === "more" ? all.slice(0, limit) : all;
    if (places.length < all.length) hasMore = true;
    return { id: section.id, title: section.title, places, total: section.total };
  });
  return { forYou: null, list: null, sections, hasMore, places: sections.flatMap((section) => section.places) };
}

/** "Ver todos" sólo si el grupo tiene más lugares de los que muestra. Sin número: la búsqueda filtrada puede dar otro. */
export const hasViewAll = (section: VisibleSection) => section.total !== null && section.total > section.places.length;

/** Un punto por card visible y por cada sucursal que salió: las de una marca apuntan a la misma card. */
export const mapPlaces = (places: SearchResult[]): MapPlace[] =>
  places.flatMap(({ id, name, lat, lng, iconCategory, branches }) => [
    { id, cardId: id, name, lat, lng, iconCategory },
    ...branches.map((branch) => ({ ...branch, cardId: id, name, iconCategory })),
  ]);
