/**
 * Alturas del panel de resultados de /search en mobile (ResultsSheet). Al volver desde la ficha no hace falta guardar
 * nada: con cacheComponents, Next conserva el estado de la página anterior (altura, scroll, card flotante).
 */

/**
 * Sólo la manija y "N lugares" (~53px) más lugar para la barra de inicio de iOS. La card flotante del marcador
 * (SelectedPlace.module.scss) va 12px arriba de esta altura y el mapa (MapColumn.module.scss) termina en ella: si
 * cambia, cambia allá también.
 */
export const SHEET_LOW = "104px";
/** La mitad de la pantalla: arranca acá. */
export const SHEET_MID = 0.5;
/** Toda la pantalla: el popup mide hasta el header, así que queda justo debajo. */
export const SHEET_HIGH = 1;

export const SHEET_SNAP_POINTS = [SHEET_LOW, SHEET_MID, SHEET_HIGH];

export type SheetSnapPoint = typeof SHEET_LOW | typeof SHEET_MID | typeof SHEET_HIGH;

/** Lo que devuelve el Drawer como una de las tres alturas; cualquier otra cosa (cerrar), la baja. */
export const toSnapPoint = (value: unknown): SheetSnapPoint =>
  (SHEET_SNAP_POINTS.find((point) => Object.is(point, value)) as SheetSnapPoint | undefined) ?? SHEET_LOW;
