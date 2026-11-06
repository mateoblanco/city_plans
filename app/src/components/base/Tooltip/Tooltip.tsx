"use client";

import type { ReactNode } from "react";
import { Tooltip as TooltipBase } from "@base-ui/react/tooltip";
import styles from "./Tooltip.module.scss";

type Props = {
  /** Lo que se ve (un texto corto); es el botón que abre el tooltip con hover o foco. */
  trigger: ReactNode;
  /** Contenido del tooltip. */
  children: ReactNode;
};

/** Tooltip de Base UI: un texto con subrayado punteado que muestra más al pasar o enfocar. */
const Tooltip = (props: Props) => (
  <TooltipBase.Root>
    <TooltipBase.Trigger className={styles.trigger} delay={150}>
      {props.trigger}
    </TooltipBase.Trigger>
    <TooltipBase.Portal>
      <TooltipBase.Positioner className={styles.positioner} sideOffset={6}>
        <TooltipBase.Popup className={styles.popup}>{props.children}</TooltipBase.Popup>
      </TooltipBase.Positioner>
    </TooltipBase.Portal>
  </TooltipBase.Root>
);

export default Tooltip;
