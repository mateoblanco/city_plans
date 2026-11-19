"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import { useDeferredMount } from "@/components/pages/PlacePage/PlaceMap/use-deferred-mount";
import { scrollToGuidePlace } from "../../utils/place-anchor";
import type { GuidePin } from "../../utils/pins";
import styles from "./GuideMapColumn.module.scss";

// Maps JS y @vis.gl sólo cuando se monta (nunca en el servidor ni en mobile).
const GuideMap = dynamic(() => import("../GuideMap/GuideMap"), { ssr: false });

type Props = {
  pins: GuidePin[];
  /** false para bots (y antes de hidratar): queda el recuadro liso. */
  enabled: boolean;
};

/**
 * Columna del mapa en desktop (desde md), fija al costado de la lista (sticky). Maps JS se monta como en la ficha
 * (useDeferredMount): desde md, después del `load`, con el recuadro en pantalla y el navegador libre. Hasta entonces, y
 * para bots, el recuadro con el color de fondo del mapa. Click en un pin: scroll a ese lugar de la lista.
 */
const GuideMapColumn = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useDeferredMount(ref, "md", props.enabled && props.pins.length > 0);

  return (
    <aside className={styles.column} aria-label="Mapa de la guía">
      <div ref={ref} className={styles.frame}>
        {ready && <GuideMap pins={props.pins} onSelect={scrollToGuidePlace} gestureHandling="cooperative" />}
      </div>
    </aside>
  );
};

export default GuideMapColumn;
