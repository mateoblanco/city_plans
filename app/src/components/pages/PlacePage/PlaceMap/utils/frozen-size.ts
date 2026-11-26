export type Size = { width: number; height: number };

/** Lo que usa freezeWhileResizing del navegador (inyectable para los tests). */
export type FreezeDeps = {
  /** Avisa cada cambio de tamaño del recuadro (ResizeObserver; la primera vez, el tamaño inicial). Devuelve la limpieza. */
  observe: (onSize: (size: Size) => void) => () => void;
  /** Fija el mapa en ese tamaño, en píxeles; con null vuelve al del CSS (el del recuadro). */
  apply: (size: Size | null) => void;
  /** Corre `run` después de `ms` (setTimeout). Devuelve cómo cancelarlo. */
  wait: (run: () => void, ms: number) => () => void;
};

/** Cuánto tiene que quedarse quieto el recuadro para que el mapa tome su tamaño nuevo. */
export const SETTLE_MS = 150;

/**
 * El mapa de Maps JS es WebGL: cada cambio de tamaño rehace el canvas y lo redibuja entero, esperando a la GPU en el
 * hilo principal. Al arrastrar el borde de la ventana eso pasa en cada frame y la página se traba. Así, al primer
 * cambio el mapa se queda con el tamaño que tenía (el recuadro lo recorta) y toma el nuevo una sola vez, cuando el
 * recuadro lleva SETTLE_MS sin cambiar. Devuelve la limpieza.
 */
export function freezeWhileResizing(deps: FreezeDeps, settleMs = SETTLE_MS): () => void {
  let settled: Size | null = null;
  let latest: Size | null = null;
  let cancel: (() => void) | null = null;

  const stop = deps.observe((size) => {
    latest = size;
    if (!settled) {
      settled = size;
      return;
    }
    if (!cancel) {
      if (size.width === settled.width && size.height === settled.height) return;
      deps.apply(settled);
    } else cancel();
    cancel = deps.wait(() => {
      cancel = null;
      settled = latest;
      deps.apply(null);
    }, settleMs);
  });

  return () => {
    stop();
    cancel?.();
    deps.apply(null);
  };
}
