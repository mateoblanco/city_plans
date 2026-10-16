import type { ReactNode } from "react";
import styles from "./MapColumn.module.scss";

type Props = {
  /** El mapa; sin children la columna queda reservada vacía (sin búsqueda, cargando o con error). */
  children?: ReactNode;
};

/** Columna fija del mapa a la derecha, debajo del header. */
const MapColumn = (props: Props) => {
  return props.children ? (
    <aside className={styles.map} aria-label="Mapa de resultados">
      {props.children}
    </aside>
  ) : (
    <div className={styles.map} />
  );
};

export default MapColumn;
