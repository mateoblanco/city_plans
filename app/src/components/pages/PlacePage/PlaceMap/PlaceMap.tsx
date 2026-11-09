"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
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
};

/**
 * Mapa chico con sólo este lugar. Maps JS se baja recién cuando hace falta (useDeferredMount): en mobile, cuando el
 * mapa se acerca a la pantalla; en desktop, después de cargar la página. Mientras tanto, el mismo recuadro (ya tiene su
 * tamaño final: no salta nada).
 */
const PlaceMap = (props: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const ready = useDeferredMount(ref, "ml");

  return (
    <div ref={ref} className={styles.map}>
      {ready && <MapView name={props.name} lat={props.lat} lng={props.lng} iconCategory={props.iconCategory} />}
    </div>
  );
};

export default PlaceMap;
