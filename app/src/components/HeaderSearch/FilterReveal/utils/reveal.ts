/** Pasando este scroll (bajando), la fila de filtros de la home se guarda. */
export const HIDE_AFTER_PX = 80;
/** Por debajo de este scroll vuelve. Entre los dos no cambia nada (histéresis: no parpadea en el borde). */
export const SHOW_BEFORE_PX = 10;

export type RevealState = {
  hidden: boolean;
  /** El scroll de la última lectura, para saber si se está bajando. */
  lastY: number;
};

export type RevealEvent =
  | {
      kind: "scroll";
      y: number;
      /** Input del buscador con foco, foco dentro de la fila o un desplegable de filtro abierto: no se guarda. */
      locked: boolean;
    }
  /** Foco en el input del buscador: vuelve aunque esté abajo. */
  | { kind: "focus" };

/**
 * La fila de filtros de la home (FilterReveal): se guarda al bajar pasando HIDE_AFTER_PX y vuelve al tope o al enfocar
 * el buscador. Bloqueada nunca se guarda; al soltarse (blur, desplegable cerrado), el siguiente scroll hacia abajo la
 * guarda. Subir sin llegar al tope no la muestra.
 */
export const nextReveal = (state: RevealState, event: RevealEvent): RevealState => {
  if (event.kind === "focus") return { ...state, hidden: false };
  const { y, locked } = event;
  if (y < SHOW_BEFORE_PX) return { hidden: false, lastY: y };
  if (!state.hidden && !locked && y > HIDE_AFTER_PX && y > state.lastY) return { hidden: true, lastY: y };
  return { hidden: state.hidden, lastY: y };
};
