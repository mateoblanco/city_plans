import type { ReactNode } from "react";
import styles from "./MapColumn.module.scss";

type Props = {
  /** El mapa, o su skeleton mientras carga la búsqueda. */
  children: ReactNode;
};

/** Columna fija del mapa a la derecha, debajo del header. */
const MapColumn = (props: Props) => {
  return (
    <aside className={styles.map} aria-label="Mapa de resultados">
      {props.children}
    </aside>
  );
};

export default MapColumn;
