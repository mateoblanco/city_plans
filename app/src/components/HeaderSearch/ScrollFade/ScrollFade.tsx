"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ScrollFade.module.scss";

type Props = {
  /** Clase del contenedor que scrollea (la línea de la barra o de las pestañas). */
  className: string;
  children: React.ReactNode;
};

/**
 * La línea de la barra con scroll horizontal (mobile) y un degradado sobre el borde derecho, como los carruseles de la
 * home (RowScroller): se va al llegar al final o si no hay nada que scrollear; no tapa clicks ni scroll. Desde md el
 * envoltorio no es una caja (display: contents) y el degradado no se muestra.
 */
const ScrollFade = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  // Antes de hidratar se muestra: en mobile casi siempre hay más filtros que ancho.
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const line = ref.current;
    if (!line) return;
    const update = () => setAtEnd(line.scrollLeft + line.clientWidth >= line.scrollWidth - 1);
    update();
    line.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(line);
    return () => {
      line.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={styles.wrapper} data-at-end={atEnd || undefined}>
      <div ref={ref} className={props.className}>
        {props.children}
      </div>
      <div className={styles.fade} aria-hidden />
    </div>
  );
};

export default ScrollFade;
