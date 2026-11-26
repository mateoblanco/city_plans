"use client";

import { useEffect, useRef } from "react";

/**
 * Publica el alto real del header en --header-offset: lo fijo debajo (el mapa de /search) arranca ahí.
 * El header cambia de alto al aparecer la barra de filtros o los sub-filtros de una intención.
 *
 * También publica --header-offset-collapsed: el alto sin la segunda fila (la barra de filtros), medido hasta el borde de
 * abajo de la primera. No se mueve mientras la barra se colapsa o se expande (en /search mobile, al entrar o salir de
 * la altura alta del panel): el panel de resultados (ResultsSheet) mide con éste y no cambia de alto en cada frame de
 * esa transición.
 *
 * Con el buscador abierto (Header expandable, SearchExpand pone data-search-open y, mientras se pliega o despliega,
 * data-search-moving) no escribe nada: el header crece encima de la página y lo de abajo no se mueve. Al cerrarse del
 * todo vuelve a medir.
 */
const HeaderOffset = () => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const header = ref.current?.closest("header");
    if (!header) return;
    const top = header.querySelector<HTMLElement>("[data-header-top]");
    const root = document.documentElement;
    let collapsed = "";
    const expanded = () => header.hasAttribute("data-search-open") || header.hasAttribute("data-search-moving");
    const measure = () => {
      if (expanded()) return;
      root.style.setProperty("--header-offset", `${header.offsetHeight}px`);
      if (!top) return;
      // Sólo se escribe si cambió: durante la transición de la barra de filtros queda igual y no invalida estilos.
      const next = `${Math.round(top.offsetTop + top.offsetHeight + parseFloat(getComputedStyle(header).paddingBottom))}px`;
      if (next === collapsed) return;
      collapsed = next;
      root.style.setProperty("--header-offset-collapsed", next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    const attributes = new MutationObserver(measure);
    attributes.observe(header, { attributes: true, attributeFilter: ["data-search-open", "data-search-moving"] });
    return () => {
      observer.disconnect();
      attributes.disconnect();
      root.style.removeProperty("--header-offset");
      root.style.removeProperty("--header-offset-collapsed");
    };
  }, []);

  return <span ref={ref} hidden />;
};

export default HeaderOffset;
