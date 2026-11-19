/** Id del <article> de un lugar de la guía (el destino del scroll desde el mapa). */
export const guidePlaceId = (id: string) => `guide-${id}`;

/**
 * Lleva a la vista un lugar de la lista (desde un pin) y le pasa el foco, así el teclado y el lector siguen desde ahí.
 * Suave salvo con movimiento reducido.
 */
export function scrollToGuidePlace(id: string) {
  const element = document.getElementById(guidePlaceId(id));
  if (!element) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  element.focus({ preventScroll: true });
}
