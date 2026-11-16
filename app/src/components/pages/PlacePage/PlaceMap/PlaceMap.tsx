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
  /** La imagen de Static Maps para mobile (StaticMap, del servidor); se oculta desde ml con CSS. */
  children?: ReactNode;
};

/**
 * Mapa chico con sólo este lugar. Mobile (debajo de ml): la imagen de Static Maps que viene en el HTML; Maps JS nunca
 * se baja. Desktop: el mapa interactivo de Maps JS, montado después de cargar la página (useDeferredMount). Mientras
 * tanto, el mismo recuadro (ya tiene su tamaño final: no salta nada).
 */
const PlaceMap = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useDeferredMount(ref, "ml");

  return (
    <div ref={ref} className={styles.map}>
      {props.children}
      {ready && <MapView name={props.name} lat={props.lat} lng={props.lng} iconCategory={props.iconCategory} />}
    </div>
  );
};

export default PlaceMap;
