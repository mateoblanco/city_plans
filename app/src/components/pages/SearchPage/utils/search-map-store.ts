import type { SearchResult } from "@/server/search";
import type { Bounds } from "@/lib/location";
import type { ChipRef, SearchUrl } from "./search-href";
import type { LatLng, MapPlace } from "../Results/Map/SearchMap/SearchMap";
import { mapPlaces, stableMapPlaces } from "./pagination";
import type { NearbyCount } from "./results-count";

/**
 * Lo que la lista de /search le pasa al mapa. El mapa (MapSync) vive fuera del Suspense con key de la búsqueda y se
 * monta una vez; la lista (ResultsView), que se vuelve a montar con cada búsqueda o filtro, publica acá lo visible.
 */
export type SearchMapState = {
  /** Un punto por card visible y por sucursal; el mismo objeto por id mientras no cambie (ver stableMapPlaces). */
  places: MapPlace[];
  /** Las cards visibles: de acá sale la card flotante del marcador tocado (mobile). */
  results: SearchResult[];
  /** Cerca mío: la ubicación (redondeada) con la que se buscó. */
  near: LatLng | null;
  /** Cuántos lugares trajo la búsqueda (el título del panel en mobile). */
  count: number;
  /** "Cerca de <barrio>": el barrio y cuántos hay cerca, para el contador ("18 lugares en Palermo · 6 cerca"). */
  nearby: NearbyCount | null;
  /** Entre que se desmonta una lista y llega la siguiente (o todavía no llegó ninguna): el skeleton. */
  pending: boolean;
  /** Sube con cada búsqueda nueva (no con "Ver más"): el mapa vuelve a encuadrar sólo cuando cambia. */
  fitKey: number;
  /**
   * "Zona del mapa": el área con la que se buscó. El mapa no se reencuadra (la vista ya la eligió la persona), salvo que
   * recién se cree (un link compartido): ahí encuadra la zona.
   */
  zone: Bounds | null;
  /** La persona movió el mapa (arrastre o zoom) desde el último encuadre: el área visible, para "Buscar en esta zona". */
  viewport: Bounds | null;
  /** La búsqueda de la lista y sus chips de barrio: con esto "Buscar en esta zona" arma el link. */
  base: { state: SearchUrl; chips: ChipRef[] } | null;
  /** Esperando la ubicación de la persona (primera búsqueda con cerca mío): "Buscando cerca tuyo…". */
  locating: boolean;
};

export type SearchMapPublish = {
  results: SearchResult[];
  near: LatLng | null;
  count: number;
  nearby?: NearbyCount | null;
  zone?: Bounds | null;
  base?: SearchMapState["base"];
};

export type SearchMapStore = {
  getState: () => SearchMapState;
  subscribe: (onChange: () => void) => () => void;
  /** Se montó la lista de una búsqueda nueva: lo próximo que publique se encuadra. */
  begin: () => void;
  /** Lo visible de la lista (cada vez que cambia la página). Sin cambios no avisa a nadie. */
  publish: (input: SearchMapPublish) => void;
  /** Se desmontó la lista (llega otra búsqueda): los marcadores quedan hasta que publique la nueva. */
  end: () => void;
  /** El mapa se movió a mano (el área visible) o volvió a encuadrarse / se buscó en la zona (null). */
  setViewport: (bounds: Bounds | null) => void;
  setLocating: (locating: boolean) => void;
};

const sameList = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, index) => item === b[index]);
const sameNearby = (a: NearbyCount | null, b: NearbyCount | null) =>
  a === b || (a !== null && b !== null && a.label === b.label && a.count === b.count && a.only === b.only);
const sameLatLng = (a: LatLng | null, b: LatLng | null) => a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);
const sameBounds = (a: Bounds | null, b: Bounds | null) =>
  a === b || (a !== null && b !== null && a.south === b.south && a.west === b.west && a.north === b.north && a.east === b.east);
const sameBase = (a: SearchMapState["base"], b: SearchMapState["base"]) => a === b || JSON.stringify(a) === JSON.stringify(b);

export const INITIAL_SEARCH_MAP_STATE: SearchMapState = {
  places: [],
  results: [],
  near: null,
  count: 0,
  nearby: null,
  pending: true,
  fitKey: 0,
  zone: null,
  viewport: null,
  base: null,
  locating: false,
};

export function createSearchMapStore(): SearchMapStore {
  let state = INITIAL_SEARCH_MAP_STATE;
  let fresh = false;
  const listeners = new Set<() => void>();
  const set = (next: SearchMapState) => {
    state = next;
    listeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    begin: () => {
      fresh = true;
    },
    publish: (input) => {
      const previous = new Map(state.places.map((place) => [place.id, place]));
      const stable = stableMapPlaces(previous, mapPlaces(input.results));
      const places = sameList(stable, state.places) ? state.places : stable;
      const results = sameList(input.results, state.results) ? state.results : input.results;
      const near = sameLatLng(input.near, state.near) ? state.near : input.near;
      const nearby = sameNearby(input.nearby ?? null, state.nearby) ? state.nearby : (input.nearby ?? null);
      const zone = sameBounds(input.zone ?? null, state.zone) ? state.zone : (input.zone ?? null);
      const base = sameBase(input.base ?? null, state.base) ? state.base : (input.base ?? null);
      const fitKey = fresh ? state.fitKey + 1 : state.fitKey;
      // Una búsqueda nueva: el botón "Buscar en esta zona" se va hasta que se vuelva a mover el mapa.
      const viewport = fresh ? null : state.viewport;
      fresh = false;
      if (
        places === state.places && results === state.results && near === state.near && nearby === state.nearby && input.count === state.count &&
        !state.pending && fitKey === state.fitKey && zone === state.zone && base === state.base && viewport === state.viewport && !state.locating
      ) return;
      set({ ...state, places, results, near, count: input.count, nearby, pending: false, fitKey, zone, base, viewport, locating: false });
    },
    end: () => {
      if (!state.pending) set({ ...state, pending: true });
    },
    setViewport: (bounds) => {
      if (!sameBounds(bounds, state.viewport)) set({ ...state, viewport: bounds });
    },
    setLocating: (locating) => {
      if (locating !== state.locating) set({ ...state, locating });
    },
  };
}
