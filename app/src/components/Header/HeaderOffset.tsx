"use client";

import { useEffect, useRef } from "react";

/**
 * Publica el alto real del header en --header-offset: lo fijo debajo (el mapa de /search) arranca ahí.
 * El header cambia de alto al aparecer la barra de filtros o los sub-filtros de una intención.
 */
const HeaderOffset = () => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = ref.current?.closest("header");
    if (!header) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty("--header-offset", `${header.offsetHeight}px`));
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--header-offset");
    };
  }, []);

  return <span ref={ref} hidden />;
};

export default HeaderOffset;
