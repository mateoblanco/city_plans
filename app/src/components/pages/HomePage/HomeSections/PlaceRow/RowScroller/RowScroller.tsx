"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./RowScroller.module.scss";

type Props = {
  /** Clase del <ul> que scrollea (la de PlaceRow). */
  className: string;
  children: React.ReactNode;
};

/**
 * El <ul> con scroll horizontal de una fila y un degradado sobre el borde derecho que difumina la última card visible,
 * para que se note que hay más. Se va al llegar al final (o si no hay nada que scrollear); no tapa clicks ni scroll.
 */
const RowScroller = (props: Props) => {
  const ref = useRef<HTMLUListElement>(null);
  // Antes de hidratar se muestra: casi siempre hay más cards que ancho.
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const update = () => setAtEnd(list.scrollLeft + list.clientWidth >= list.scrollWidth - 1);
    update();
    list.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    return () => {
      list.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={styles.wrapper} data-at-end={atEnd || undefined}>
      <ul ref={ref} className={props.className}>
        {props.children}
      </ul>
      <div className={styles.fade} aria-hidden />
    </div>
  );
};

export default RowScroller;
