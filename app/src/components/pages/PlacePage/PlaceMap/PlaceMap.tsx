"use client";

import dynamic from "next/dynamic";
import { useRef, type ReactNode } from "react";
import type { IconCategory } from "@shared/icon-categories.ts";
import { useDeferredMount } from "./use-deferred-mount";
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
 * sólo el recuadro liso.
 */
const PlaceMap = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useDeferredMount(ref, "ml", !props.plain);

  if (props.plain) return <div className={styles.map} data-plain aria-hidden />;
  return (
    <div ref={ref} className={styles.map}>
      {props.children}
      {ready && <MapView name={props.name} lat={props.lat} lng={props.lng} iconCategory={props.iconCategory} />}
    </div>
  );
};

export default PlaceMap;
