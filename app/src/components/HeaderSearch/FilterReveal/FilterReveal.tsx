"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { animate } from "motion/mini";
import { HIDE_AFTER_PX, nextReveal, type RevealEvent, type RevealState } from "./utils/reveal";
import styles from "./FilterReveal.module.scss";

/** ~220 ms con ease-out: se guarda rápido y frena al final, debajo del buscador. */
const DURATION_S = 0.22;
const EASE = [0.22, 1, 0.36, 1] as const;
/** Cuánto sube la fila mientras se va. */
const LIFT_PX = 6;

type Props = {
  /** La barra de filtros (con su Suspense). */
  children: ReactNode;
};

/**
 * La home: la fila de filtros del header se guarda al bajar y vuelve al tope o al enfocar el buscador (la lógica,
 * en utils/reveal.ts). Todo imperativo, sin estado de React: el scroll no re-renderiza nada.
 *
 * Sin saltos (CLS 0): el header es sticky, en el flujo. Mientras la fila (`.bottom` del Header) pliega su alto y el gap
 * de arriba, el header gana el mismo margen abajo, en la misma animación: el alto que ocupa en el flujo no cambia en
 * ningún frame y el contenido no se mueve.
 */
const FilterReveal = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = ref.current;
    const bottom = content?.parentElement;
    const header = content?.closest("header");
    if (!content || !bottom || !header) return;
    const input = header.querySelector<HTMLInputElement>('[data-header-top] input[type="search"]');
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    let state: RevealState = { hidden: false, lastY: window.scrollY };
    // El alto natural de la fila: el contenido no lo achica el padre (que es el que se pliega).
    let full = content.offsetHeight;
    let running: { stop: () => void }[] = [];
    let generation = 0;
    let frame = 0;

    // Input con foco, foco dentro de la fila (teclado) o un desplegable abierto (su popup va en un portal: se mira el
    // aria-expanded del botón, que ponen Select y Popover de Base UI).
    const locked = () => {
      const active = document.activeElement;
      return (input !== null && active === input) || bottom.contains(active) || bottom.querySelector('[aria-expanded="true"]') !== null;
    };

    const gapPx = () => parseFloat(getComputedStyle(header).rowGap) || 0;

    // Mostrada y quieta, sin estilos inline: vuelve a `height: auto` y a lo del CSS.
    const clearInline = () => {
      for (const property of ["height", "marginBottom", "opacity", "transform"] as const) bottom.style[property] = "";
      header.style.marginBottom = "";
      delete bottom.dataset.folded;
    };

    const render = (hidden: boolean) => {
      const token = ++generation;
      const gap = gapPx();
      running.forEach((animation) => animation.stop());
      running = [];
      bottom.inert = hidden;
      bottom.dataset.folded = "";
      const target = hidden
        ? { height: "0px", marginBottom: `${-gap}px`, opacity: "0", transform: `translateY(-${LIFT_PX}px)` }
        : { height: `${full}px`, marginBottom: "0px", opacity: "1", transform: "translateY(0px)" };
      const headerTarget = { marginBottom: hidden ? `${full + gap}px` : "0px" };

      // prefers-reduced-motion: el cambio directo.
      if (reducedMotion.matches) {
        if (hidden) {
          Object.assign(bottom.style, target);
          Object.assign(header.style, headerTarget);
        } else clearInline();
        return;
      }

      // Interrumpida a la mitad: motion/mini fija el valor actual y arranca desde ahí; la duración es la del tramo que
      // falta (la opacidad dice cuánto), así no frena ni salta.
      const opacity = parseFloat(getComputedStyle(bottom).opacity);
      const remaining = hidden ? opacity : 1 - opacity;
      const options = { duration: DURATION_S * Math.max(remaining, 0.25), ease: EASE };
      // Las dos en el mismo frame y con la misma curva: el alto que se pliega es el margen que gana el header.
      const row = animate(bottom, target, options);
      const offset = animate(header, headerTarget, options);
      running = [row, offset];
      Promise.all([row.finished, offset.finished]).then(() => {
        if (token !== generation) return;
        running = [];
        if (!hidden) clearInline();
      });
    };

    const update = (event: RevealEvent) => {
      const next = nextReveal(state, event);
      const changed = next.hidden !== state.hidden;
      state = next;
      if (changed) render(next.hidden);
    };

    // Pasivo y como mucho una lectura por frame; el bloqueo se mira sólo cuando podría guardarse.
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const couldHide = !state.hidden && y > HIDE_AFTER_PX && y > state.lastY;
        update({ kind: "scroll", y, locked: couldHide && locked() });
      });
    };

    const onFocusIn = (event: FocusEvent) => {
      if (input && event.target === input) update({ kind: "focus" });
    };

    // Guardada, si cambia el alto de la fila (el ancho de la ventana, el wrap en desktop), el margen lo sigue.
    const observer = new ResizeObserver(() => {
      full = content.offsetHeight;
      if (state.hidden && running.length === 0) header.style.marginBottom = `${full + gapPx()}px`;
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    header.addEventListener("focusin", onFocusIn);
    observer.observe(content);
    return () => {
      window.removeEventListener("scroll", onScroll);
      header.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
      cancelAnimationFrame(frame);
      running.forEach((animation) => animation.stop());
      bottom.inert = false;
      clearInline();
    };
  }, []);

  return (
    <div ref={ref} className={styles.reveal}>
      {props.children}
    </div>
  );
};

export default FilterReveal;
