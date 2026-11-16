"use client";

import { useEffect, useState, type RefObject } from "react";
import { desktopQuery, type Breakpoint } from "@/components/pages/SearchPage/utils/use-mobile";

/**
 * Cuándo montar el mapa interactivo de la ficha (Maps JS no se baja antes). Sólo desde el breakpoint (desktop): después
 * de que cargó la página (evento `load`) y el navegador quedó libre, así no compite con el contenido principal. Debajo
 * del breakpoint nunca: ahí va la imagen de Static Maps (StaticMap) y no se baja nada de Maps JS. Si la ventana pasa a
 * ser ancha (girar una tablet, agrandar la ventana), se monta en ese momento.
 */
export function useDeferredMount(ref: RefObject<HTMLElement | null>, breakpoint: Breakpoint): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ready) return;
    if (!ref.current) return;
    const query = desktopQuery(breakpoint);

    let idle: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const mount = () => {
      if (!query.matches || idle !== undefined || timeout !== undefined) return;
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      else timeout = setTimeout(() => setReady(true), 200);
    };
    const onChange = () => {
      if (document.readyState === "complete") mount();
    };

    if (document.readyState === "complete") mount();
    else window.addEventListener("load", mount, { once: true });
    query.addEventListener("change", onChange);
    return () => {
      window.removeEventListener("load", mount);
      query.removeEventListener("change", onChange);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [ref, breakpoint, ready]);

  return ready;
}
