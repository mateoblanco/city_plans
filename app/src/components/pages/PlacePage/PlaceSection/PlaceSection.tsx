import type { ReactNode } from "react";
import styles from "./PlaceSection.module.scss";

type Props = {
  title: string;
  children: ReactNode;
};

/** Una sección de la columna izquierda de la ficha: título y contenido. */
const PlaceSection = (props: Props) => (
  <section className={styles.section}>
    <h2 className={styles.title}>{props.title}</h2>
    {props.children}
  </section>
);

export default PlaceSection;
