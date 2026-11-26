import type { ReactNode } from "react";
import HeaderBack from "@/components/Header/HeaderBack/HeaderBack";
import styles from "./TabsLine.module.scss";

type Props = {
  /** El breakpoint de la página (Header compactBelow): md en /search y las guías, ml en la ficha. */
  below: "md" | "ml";
  /** Las pestañas de intención (IntentTabs con afterBack). */
  children: ReactNode;
};

/**
 * Mobile: la primera línea del header, con la flecha de volver pegada a la izquierda y las pestañas en el resto
 * (centradas si entran; si no, con scroll desde la flecha). Desde el breakpoint no es una caja: las pestañas quedan
 * como siempre, centradas arriba del input, y la flecha no se muestra.
 */
const TabsLine = (props: Props) => (
  <div className={styles.line} data-below={props.below}>
    <HeaderBack below={props.below} />
    {props.children}
  </div>
);

export default TabsLine;
