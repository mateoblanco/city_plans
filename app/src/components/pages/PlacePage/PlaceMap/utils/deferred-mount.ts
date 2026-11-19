/** Lo que usa scheduleMount del navegador (inyectable para los tests). */
export type MountDeps = {
  /** La media query de desktop (desktopQuery("ml")): debajo, nunca se monta. */
  query: Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">;
  /** document.readyState === "complete" ya, o esperar el `load` de la ventana. */
  loaded: () => boolean;
  onLoad: (run: () => void) => () => void;
  /** Avisa cuando el recuadro entra o sale de la pantalla (IntersectionObserver). Devuelve la limpieza. */
  observe: (onChange: (visible: boolean) => void) => () => void;
  /** Corre `run` con el navegador libre (requestIdleCallback, o un timeout). Devuelve cómo cancelarlo. */
  idle: (run: () => void) => () => void;
};

/**
 * Cuándo montar el mapa interactivo de la ficha: las tres cosas a la vez, en desktop (la media query), con la página ya
 * cargada (`load`) y con el recuadro en pantalla; ahí espera a que el navegador quede libre y llama a `mount` una sola
 * vez. Si falta una, sigue esperando (scrollear hasta el mapa, agrandar la ventana). Devuelve la limpieza.
 */
export function scheduleMount(deps: MountDeps, mount: () => void): () => void {
  let loaded = deps.loaded();
  let visible = false;
  let cancelIdle: (() => void) | null = null;
  let done = false;

  const tryMount = () => {
    if (done || cancelIdle || !loaded || !visible || !deps.query.matches) return;
    cancelIdle = deps.idle(() => {
      done = true;
      mount();
    });
  };

  const stopLoad = loaded ? () => {} : deps.onLoad(() => {
    loaded = true;
    tryMount();
  });
  const stopObserve = deps.observe((isVisible) => {
    visible = isVisible;
    tryMount();
  });
  deps.query.addEventListener("change", tryMount);
  tryMount();

  return () => {
    stopLoad();
    stopObserve();
    deps.query.removeEventListener("change", tryMount);
    if (!done) cancelIdle?.();
  };
}
