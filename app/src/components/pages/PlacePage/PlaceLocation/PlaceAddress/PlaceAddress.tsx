"use client";

import { usePlaceGoogle } from "../../PlaceGoogle/utils/context";
import styles from "./PlaceAddress.module.scss";

/**
 * La calle de Google, que llega desde el navegador (PlaceGoogle). Mientras tanto, o si no vino, la línea queda vacía con
 * su alto (no sube lo de abajo).
 */
const PlaceAddress = () => {
  const google = usePlaceGoogle();
  const address = google.status === "ready" ? google.info.address : null;
  return address ? <p className={styles.address}>{address}</p> : <p className={styles.address} aria-hidden />;
};

export default PlaceAddress;
