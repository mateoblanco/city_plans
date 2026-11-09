import { useSyncExternalStore } from "react";

export type Breakpoint = "md" | "ml";

/**
 * Desde el breakpoint, igual que `@include media(<bp>)` en SCSS; mobile es lo contrario. El valor sale de
 * `--breakpoint-<bp>` (lo publica `styles/_breakpoints.scss`), así no se define dos veces.
 */
export const desktopQuery = (breakpoint: Breakpoint) => {
  const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--breakpoint-${breakpoint}`));
  return window.matchMedia(`(min-width: ${value || (breakpoint === "ml" ? 900 : 768)}px)`);
};

/**
 * Debajo de `md` (o del breakpoint que se pida: la ficha usa `ml`). En el servidor (y al hidratar) es desktop; en
 * mobile cambia apenas hidrata.
 */
export const useMobile = (breakpoint: Breakpoint = "md") =>
  useSyncExternalStore(
    (onChange) => {
      const query = desktopQuery(breakpoint);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => !desktopQuery(breakpoint).matches,
    () => false,
  );
