"use client";

import type { ReactNode } from "react";
import { directionsHandlers } from "../utils/directions";
import styles from "./DirectionsTracker.module.scss";

type Props = {
  placeId: string;
  children: ReactNode;
};

/**
 * "Cómo llegar": envuelve el link "Google Maps" de la ficha (PlaceLocation sigue siendo server component) y cuenta el
 * click que sube desde el link. "Abrir en pestaña nueva" desde el menú contextual no dispara eventos y no se cuenta.
 */
const DirectionsTracker = (props: Props) => (
  <span className={styles.tracker} {...directionsHandlers(props.placeId)}>
    {props.children}
  </span>
);

export default DirectionsTracker;
