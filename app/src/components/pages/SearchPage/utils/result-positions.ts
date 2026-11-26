/**
 * El puesto (desde 1) y el slug de cada card en el ranking de la búsqueda que se muestra, para search_result_clicked y
 * map_marker_clicked. Lo anota ResultsView con el orden de la respuesta (los grupos, "Más opciones" y "Cerca de"
 * conservan el puesto de la lista) y lo leen las cards al tocarlas, también la del mapa (SelectedPlace) y los
 * marcadores (MapSync), que viven fuera de la lista. En memoria del módulo; fuera de /search (home, ficha) no se usa.
 */
type Ref = { position: number; slug: string };

let refs: ReadonlyMap<string, Ref> = new Map();

export function setResultPositions(places: { id: string; slug: string }[]) {
  refs = new Map(places.map((place, index) => [place.id, { position: index + 1, slug: place.slug }]));
}

export const resultRef = (id: string): Ref | null => refs.get(id) ?? null;

export const resultPosition = (id: string): number | null => refs.get(id)?.position ?? null;
