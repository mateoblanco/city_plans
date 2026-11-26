"use client";

import { useEffect, useRef } from "react";
import { MOVE_MS, nextExpanded, type ExpandEvent } from "./utils/expand";

/**
 * El buscador plegado del header (Header expandable, en la ficha y las guías): sólo se ve el input; al enfocarlo se
 * despliegan las pestañas de intención arriba y la barra de filtros abajo, encima de la página (la lógica, en
 * utils/expand.ts). Todo imperativo, sin estado de React, como FilterReveal: pone en el <header> data-search-open
 * (abierto) y data-search-moving (mientras se pliega o despliega, para que HeaderOffset no mida ni el CSS deje de
 * recortar), y deja inert lo plegado.
 */
const SearchExpand = () => {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    // El header de esta página: con Activity, el de otra página oculta puede seguir en el DOM.
    const header = ref.current?.closest("header");
    if (!header) return;
    const input = header.querySelector<HTMLInputElement>('[data-header-top] input[type="search"]');
    const folds = [...header.querySelectorAll<HTMLElement>("[data-header-fold]")];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let open = false;
    let moving = 0;
    let focusCheck = 0;

    const render = () => {
      folds.forEach((fold) => (fold.inert = !open));
      header.toggleAttribute("data-search-open", open);
      window.clearTimeout(moving);
      if (reducedMotion.matches) {
        header.removeAttribute("data-search-moving");
        return;
      }
      header.setAttribute("data-search-moving", "");
      moving = window.setTimeout(() => header.removeAttribute("data-search-moving"), MOVE_MS);
    };

    const update = (event: ExpandEvent) => {
      const next = nextExpanded(open, event);
      if (next === open) return;
      open = next;
      render();
    };

    // Desplegable de filtro abierto (Select y Popover de Base UI ponen aria-expanded en el botón; el popup va en un
    // portal, fuera del header).
    const locked = () => header.querySelector('[aria-expanded="true"]') !== null;

    const onFocusIn = (event: FocusEvent) => {
      if (event.target !== input) return;
      update({ kind: "input" });
    };

    // Con el panel cerrado y el input con foco (después de Escape), tocarlo o escribir lo abre.
    const onInputActivity = () => update({ kind: "input" });

    // Con Tab a otra parte de la página. Se mira en la vuelta siguiente: al abrir un desplegable el foco pasa a su popup
    // y recién ahí está su aria-expanded. Foco en el body (un click en algo no enfocable, o salir de la ventana): lo
    // decide pointerdown.
    const onFocusOut = () => {
      window.clearTimeout(focusCheck);
      focusCheck = window.setTimeout(() => {
        const active = document.activeElement;
        if (!open || !active || active === document.body || header.contains(active)) return;
        update({ kind: "outside", locked: locked() });
      }, 0);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!open || header.contains(event.target as Node)) return;
      update({ kind: "outside", locked: locked() });
    };

    // Escape en cualquier parte del header abierto (el input, las pestañas o la barra) lo pliega y saca el foco: el input
    // vuelve a su tamaño chico. Con un desplegable abierto el foco está en su popup (fuera del header) y Escape lo cierra
    // a él. En el input, también le gana al Escape de Search (borrar el texto): el texto queda. Este listener nativo en
    // el header corre antes que el de React (en la raíz); stopPropagation para que no llegue y preventDefault para que el
    // navegador no borre solo el type=search.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open || locked()) return;
      if (event.target === input) {
        event.preventDefault();
        event.stopPropagation();
      }
      update({ kind: "escape" });
      (document.activeElement as HTMLElement | null)?.blur();
    };

    folds.forEach((fold) => (fold.inert = true));
    header.addEventListener("focusin", onFocusIn);
    header.addEventListener("focusout", onFocusOut);
    header.addEventListener("keydown", onKeyDown);
    input?.addEventListener("pointerdown", onInputActivity);
    input?.addEventListener("input", onInputActivity);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      header.removeEventListener("focusin", onFocusIn);
      header.removeEventListener("focusout", onFocusOut);
      header.removeEventListener("keydown", onKeyDown);
      input?.removeEventListener("pointerdown", onInputActivity);
      input?.removeEventListener("input", onInputActivity);
      document.removeEventListener("pointerdown", onPointerDown);
      window.clearTimeout(moving);
      window.clearTimeout(focusCheck);
      // Al navegar, Next oculta la página (Activity) en vez de desmontarla: al volver, cerrado.
      folds.forEach((fold) => (fold.inert = false));
      header.removeAttribute("data-search-open");
      header.removeAttribute("data-search-moving");
    };
  }, []);

  return <span ref={ref} hidden />;
};

export default SearchExpand;
