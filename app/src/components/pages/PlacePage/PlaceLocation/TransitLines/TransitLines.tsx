"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import ChevronDown from "@/assets/chevron_down.svg";
import { linePill } from "../utils/line-color";
import styles from "./TransitLines.module.scss";

type Props = {
  /** Líneas de ómnibus con parada cerca, sin repetir; no vacío. */
  lines: string[];
};

/** "Ómnibus cerca (N)": arranca cerrado en desktop y mobile; el título despliega los chips de las líneas. */
const TransitLines = (props: Props) => (
  <Collapsible.Root className={styles.transit}>
    <Collapsible.Trigger className={styles.trigger}>
      Ómnibus cerca ({props.lines.length})
      <ChevronDown aria-hidden width={10} height={6} className={styles.chevron} />
    </Collapsible.Trigger>
    {/* hiddenUntilFound: cerrado sigue en el HTML (buscar en la página lo abre). */}
    <Collapsible.Panel hiddenUntilFound className={styles.panel}>
      <ul className={styles.chips} aria-label="Líneas de ómnibus cercanas">
        {props.lines.map((line) => {
          const pill = linePill(line);
          return (
            <li key={line} className={pill ? styles.chip : `${styles.chip} ${styles.unknown}`} style={pill ? { backgroundColor: pill.background, color: pill.color } : undefined}>
              {line}
            </li>
          );
        })}
      </ul>
    </Collapsible.Panel>
  </Collapsible.Root>
);

export default TransitLines;
