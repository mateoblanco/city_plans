"use client";

import { useEffect, useEffectEvent, useRef } from "react";

type Props = {
  onReach: () => void;
};

/**
 * Scroll infinito: avisa cuando el final de la lista se acerca a la pantalla, para sumar la página siguiente (sin
 * volver a buscar). Se monta con una key por página: el observer nuevo avisa de entrada si el final sigue a la vista.
 */
const LoadMore = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const reach = useEffectEvent(props.onReach);

  useEffect(() => {
    // En mobile la lista scrollea dentro del panel: el margen se mide contra él (sin panel, contra la ventana).
    const root = ref.current?.closest<HTMLElement>("[data-drawer-content]") ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          reach();
        }
      },
      { root, rootMargin: "400px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return <div ref={ref} aria-hidden />;
};

export default LoadMore;
