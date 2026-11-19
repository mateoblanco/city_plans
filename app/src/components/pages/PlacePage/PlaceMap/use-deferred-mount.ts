"use client";

import { useEffect, useState, type RefObject } from "react";
import { desktopQuery, type Breakpoint } from "@/components/pages/SearchPage/utils/use-mobile";
import { scheduleMount } from "./utils/deferred-mount";

/**
 * Cuándo montar el mapa interactivo de la ficha (Maps JS no se baja antes; cada mapa creado se cobra como Dynamic
 * Maps). Sólo desde el breakpoint (desktop), después del `load` de la página, con el recuadro en pantalla y con el
 * navegador libre (scheduleMount): una ficha que nadie scrollea hasta el mapa no lo paga. Debajo del breakpoint nunca:
 * ahí va la imagen de Static Maps. Si la ventana pasa a ser ancha (girar una tablet, agrandar la ventana) con el recuadro
 * visible, se monta en ese momento. `enabled` en false (un bot): nunca.
 */
export function useDeferredMount(ref: RefObject<HTMLElement | null>, breakpoint: Breakpoint, enabled = true): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || ready || !element) return;
    return scheduleMount(
      {
        query: desktopQuery(breakpoint),
        loaded: () => document.readyState === "complete",
        onLoad: (run) => {
          window.addEventListener("load", run, { once: true });
          return () => window.removeEventListener("load", run);
        },
        observe: (onChange) => {
          const observer = new IntersectionObserver((entries) => onChange(entries.some((entry) => entry.isIntersecting)));
          observer.observe(element);
          return () => observer.disconnect();
        },
        idle: (run) => {
          if (typeof window.requestIdleCallback === "function") {
            const id = window.requestIdleCallback(run, { timeout: 2000 });
            return () => window.cancelIdleCallback(id);
          }
          const id = setTimeout(run, 200);
          return () => clearTimeout(id);
        },
      },
      () => setReady(true),
    );
  }, [ref, breakpoint, enabled, ready]);

  return ready;
}
