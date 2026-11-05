/**
 * Si hubo una navegación dentro de la app en esta carga de la página. Vive en memoria del módulo: una carga completa (URL
 * abierta directo, recarga, otra pestaña) empieza sin historial propio, así "← Volver" va a la home y no a otro sitio.
 */
let lastPath: string | null = null;
let navigated = false;

/** Lo llama NavigationTracker con cada pathname: un pathname distinto del anterior es una navegación dentro de la app. */
export function recordPath(path: string) {
  if (lastPath !== null && lastPath !== path) navigated = true;
  lastPath = path;
}

export function hasInAppHistory() {
  return navigated;
}

/** Sólo para tests. */
export function resetNavigation() {
  lastPath = null;
  navigated = false;
}
