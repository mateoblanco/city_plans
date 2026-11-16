/**
 * El mapa chico de la ficha: el mismo zoom en el mapa interactivo (desktop, PlaceMap/MapView) y en la imagen de Static
 * Maps (mobile, server/places/static-map.ts). El Map ID (estilo) es NEXT_PUBLIC_GOOGLE_MAP_ID en los dos.
 */
export const PLACE_MAP_ZOOM = 16;

/**
 * Debajo de este ancho de pantalla (ml, 900px: el layout de una columna de la ficha) va la imagen estática; desde acá,
 * el mapa interactivo. Tiene que coincidir con `ml` de styles/_breakpoints.scss (lo usan PlaceMap y el <picture>).
 */
export const PLACE_MAP_DESKTOP_MIN_WIDTH = 900;
