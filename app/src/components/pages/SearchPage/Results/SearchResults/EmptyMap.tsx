"use client";

import { usePublishSearchResults } from "../../utils/use-search-map";

const NONE: never[] = [];

/** Si la búsqueda falla: el mapa queda sin puntos (vuelve a Montevideo) y el panel deja de decir "Buscando…". */
const EmptyMap = () => {
  usePublishSearchResults(NONE, null, 0);
  return null;
};

export default EmptyMap;
