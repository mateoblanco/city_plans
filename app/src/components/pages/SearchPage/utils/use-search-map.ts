"use client";

import { createContext, use, useLayoutEffect } from "react";
import type { SearchResult } from "@/server/search";
import type { LatLng } from "../Results/Map/SearchMap/SearchMap";
import type { NearbyCount } from "./results-count";
import { createSearchMapStore, type SearchMapStore } from "./search-map-store";

/** El store que la lista usa para pasarle lo visible al mapa persistente (lo provee MapSync). */
export const SearchMapContext = createContext<SearchMapStore>(createSearchMapStore());

/**
 * La lista de una búsqueda publica sus cards visibles en el mapa: al montar avisa que es una búsqueda nueva (el mapa
 * va a encuadrar), en cada cambio de página publica lo visible y al desmontar deja el mapa esperando la siguiente.
 */
export function usePublishSearchResults(results: SearchResult[], near: LatLng | null, count: number, nearby: NearbyCount | null = null) {
  const store = use(SearchMapContext);
  useLayoutEffect(() => {
    store.begin();
    return () => store.end();
  }, [store]);
  useLayoutEffect(() => {
    store.publish({ results, near, count, nearby });
  }, [store, results, near, count, nearby]);
}
