import type { ReactNode } from "react";
import styles from "./PlaceInfoCard.module.scss";

type Props = {
  children: ReactNode;
};

/**
 * Prueba: una sola tarjeta para Contacto y Horarios, con un separador entre las partes. Las partes van con `bare` (sin
 * tarjeta propia); las que no se muestran no dejan separador y, sin ninguna, la tarjeta se oculta (:empty).
 */
const PlaceInfoCard = (props: Props) => <div className={styles.card}>{props.children}</div>;

export default PlaceInfoCard;
