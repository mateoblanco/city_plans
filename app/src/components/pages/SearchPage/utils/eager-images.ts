/**
 * Logos que se ven sin scroll al cargar: van con loading="eager" (Next avisa en la consola si la imagen del LCP es
 * lazy) y los primeros, además, con fetchPriority="high". El resto, lazy.
 */

/** "eager": se pide ya. "high": se pide ya y antes que el resto. */
export type ImageLoad = "eager" | "high";

/**
 * /search: las primeras cards del primer grupo. En desktop son dos filas de la grilla; en mobile (una por fila) el
 * panel a media altura muestra una o dos, así que cuatro las cubre en los dos.
 */
export const EAGER_SEARCH_CARDS = 4;

/** Home: las primeras cards de la primera fila (scroll horizontal; en mobile se ven una y media). */
export const EAGER_HOME_CARDS = 2;

/**
 * De las eager, cuántas con fetchPriority="high": las que se ven en mobile y la primera fila en desktop. Si las cuatro
 * fueran "high", ninguna pasaría adelante, y competirían con el CSS y las fuentes.
 */
export const HIGH_PRIORITY_CARDS = 2;

/** Cómo carga el logo de la card en esa posición. Sin eagerCount (otra sección, más abajo): undefined, lazy. */
export const eagerImage = (index: number, eagerCount: number | undefined): ImageLoad | undefined => {
  if (eagerCount === undefined || index >= eagerCount) return undefined;
  return index < HIGH_PRIORITY_CARDS ? "high" : "eager";
};
