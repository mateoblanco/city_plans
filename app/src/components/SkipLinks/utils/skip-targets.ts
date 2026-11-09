/**
 * Ids de los destinos de los links para saltar (SkipLinks). Cada destino lleva data-skip-target (sin anillo de foco: el
 * foco es sólo el punto de partida del próximo Tab); SkipLinks le pone tabindex="-1" al saltar.
 */
export const SKIP_TARGETS = {
  /** El <main> de la página. */
  content: "contenido",
  /** La lista de resultados de /search (ResultsView), en la página o dentro del panel de mobile. */
  results: "resultados",
  /** La columna del mapa de /search (MapColumn). */
  map: "mapa",
} as const;
