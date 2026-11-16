/** Qué hace Escape en el buscador: primero cierra un desplegable abierto; con texto, lo borra (como el ×); si no, sale. */
export function escapeAction(state: { hasText: boolean; menuOpen: boolean }): "closeMenu" | "clear" | "blur" {
  if (state.menuOpen) return "closeMenu";
  return state.hasText ? "clear" : "blur";
}

type ClearerDeps = {
  /** La URL de la búsqueda sin texto (en /search); sin ella (la home), borrar sólo borra el texto. */
  href: () => PromiseLike<string> | undefined;
  /** Si el input sigue vacío cuando llega la URL: si se volvió a escribir, no se busca sin texto. */
  stillEmpty: () => boolean;
  navigate: (href: string) => void;
};

/**
 * Borrar el texto y, en /search, volver a buscar sin él. Una sola navegación por borrado: el × y Escape seguidos (o
 * un doble toque) mientras se espera la URL no vuelven a buscar.
 */
export function createClearer(deps: ClearerDeps) {
  let pending: Promise<void> | null = null;
  return (): Promise<void> => {
    if (pending) return pending;
    const href = deps.href();
    if (!href) return Promise.resolve();
    // La promesa que manda el servidor (RSC) es un thenable de React cuyo then no devuelve otra promesa: se envuelve.
    pending = Promise.resolve(href)
      .then((url) => {
        if (deps.stillEmpty()) deps.navigate(url);
      })
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
