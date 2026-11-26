"use client";

import dynamic from "next/dynamic";
import { useRef, type ReactNode } from "react";
import type { IconCategory } from "@shared/icon-categories.ts";
import { useDeferredMount } from "./use-deferred-mount";
import { useFrozenSize } from "./use-frozen-size";
import styles from "./PlaceMap.module.scss";

// La librería de Google se carga sólo en el cliente, como en /search.
const MapView = dynamic(() => import("./MapView/MapView"), { ssr: false });

type Props = {
  name: string;
  lat: number;
  lng: number;
  iconCategory: IconCategory | null;
  /**
   * Un bot (por user agent, en el servidor): el recuadro liso, sin imagen de Static Maps ni Maps JS (cada uno se cobra).
   */
  plain: boolean;
  /** La imagen de Static Maps para mobile (StaticMap, del servidor); se oculta desde ml con CSS. Con plain, nada. */
  children?: ReactNode;
};

/**
 * Mapa chico con sólo este lugar. Mobile (debajo de ml): la imagen de Static Maps que viene en el HTML; Maps JS nunca
 * se baja. Desktop: el mapa interactivo de Maps JS, montado cuando el recuadro entra en pantalla, después de cargar la
 * página (useDeferredMount). Mientras tanto, el mismo recuadro (ya tiene su tamaño final: no salta nada). Para un bot,
 * sólo el recuadro liso. Mientras la ventana cambia de tamaño, el mapa conserva el suyo y toma el nuevo al terminar
 * (useFrozenSize): redimensionar Maps JS en cada frame trababa la página.
 */
const PlaceMap = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const ready = useDeferredMount(ref, "ml", !props.plain);
  useFrozenSize(ref, frame, ready);

  if (props.plain) return <div className={styles.map} data-plain aria-hidden />;
  return (
    <div ref={ref} className={styles.map}>
      {props.children}
      {ready && (
        <div ref={frame} className={styles.frame}>
          <MapView name={props.name} lat={props.lat} lng={props.lng} iconCategory={props.iconCategory} />
        </div>
      )}
    </div>
  );
};

export default PlaceMap;
