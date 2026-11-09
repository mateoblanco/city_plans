"use client";

import { useEffect, useState, type RefObject } from "react";
import { desktopQuery, type Breakpoint } from "@/components/pages/SearchPage/utils/use-mobile";

/**
 * Mobile: cuánto antes de entrar en pantalla empieza a cargar (Maps JS pesa ~470 KB). Con más margen, en la mayoría de
 * las fichas el mapa (unos 800–1100px más abajo) ya entra de arranque y no se ahorra nada.
 */
const NEAR_MARGIN = "200px 0px";

/**
 * Cuándo montar el mapa de la ficha (Maps JS no se baja antes). Mobile (debajo del breakpoint): cuando se
 * acerca a la pantalla. Desktop: después de que cargó la página (evento `load`) y el navegador quedó libre, así no
 * compite con el contenido principal.
 */
export function useDeferredMount(ref: RefObject<HTMLElement | null>, breakpoint: Breakpoint): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    const element = ref.current;
    if (!element) return;

    if (!desktopQuery(breakpoint).matches) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            setReady(true);
          }
        },
        { rootMargin: NEAR_MARGIN },
      );
      observer.observe(element);
      return () => observer.disconnect();
    }

    let idle: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const mount = () => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      else timeout = setTimeout(() => setReady(true), 200);
    };
    if (document.readyState === "complete") mount();
    else window.addEventListener("load", mount, { once: true });
    return () => {
      window.removeEventListener("load", mount);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [ref, breakpoint, ready]);

  return ready;
}
