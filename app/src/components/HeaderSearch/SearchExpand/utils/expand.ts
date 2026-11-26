/** Lo que dura la transición de plegar y desplegar (Header.module.scss, .fold), con margen. */
export const MOVE_MS = 260;

export type ExpandEvent =
  /** Foco en el input del buscador, o tocarlo o escribir en él con el panel cerrado. */
  | { kind: "input" }
  /**
   * Un toque fuera del header, o el foco que se fue a otra parte de la página (Tab). `locked`: hay un desplegable de
   * filtro abierto (su popup va en un portal, fuera del header): no se cierra.
   */
  | { kind: "outside"; locked: boolean }
  /** Escape con el foco en el header (el input, las pestañas o la barra). */
  | { kind: "escape" };

/**
 * El buscador plegado del header de la ficha y las guías (SearchExpand): se abre al enfocar el input y se cierra al
 * tocar afuera, al salir con el foco o con Escape. Con un desplegable de filtro abierto no se cierra.
 */
export const nextExpanded = (open: boolean, event: ExpandEvent): boolean => {
  if (event.kind === "input") return true;
  if (event.kind === "escape") return false;
  return event.locked ? open : false;
};
