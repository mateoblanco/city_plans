import type { ReactNode } from "react";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import styles from "./MapColumn.module.scss";

type Props = {
  /** El mapa (SearchMap, que se carga sólo en el cliente). */
  children: ReactNode;
};

/**
 * Columna fija del mapa a la derecha, debajo del header (en mobile, el fondo de toda la pantalla, también debajo del
 * header). Hasta que Google dibuja, se ve el fondo propio de `.frame`: un color liso, sin imágenes (no compite por el
 * LCP).
 */
const MapColumn = (props: Props) => {
  return (
    <aside id={SKIP_TARGETS.map} className={styles.map} aria-label="Mapa de resultados" data-skip-target>
      <div className={styles.frame}>{props.children}</div>
    </aside>
  );
};

export default MapColumn;
