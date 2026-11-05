"use client";

import dynamic from "next/dynamic";
import type { IconCategory } from "@shared/icon-categories.ts";
import styles from "./PlaceMap.module.scss";

// La librería de Google se carga sólo en el cliente, como en /search.
const MapView = dynamic(() => import("./MapView/MapView"), { ssr: false });

type Props = {
  name: string;
  lat: number;
  lng: number;
  iconCategory: IconCategory | null;
};

/** Mapa chico con sólo este lugar. */
const PlaceMap = (props: Props) => (
  <div className={styles.map}>
    <MapView name={props.name} lat={props.lat} lng={props.lng} iconCategory={props.iconCategory} />
  </div>
);

export default PlaceMap;
