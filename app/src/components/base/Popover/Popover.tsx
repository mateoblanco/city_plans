"use client";

import type { ReactNode } from "react";
import { Popover as PopoverBase } from "@base-ui/react/popover";
import { accessibleName } from "@/components/base/Select/Select";
import ChevronDown from "@/assets/chevron_down.svg";
import styles from "./Popover.module.scss";

type Props = {
  /** Qué filtra ("Descuentos"): va en el nombre accesible después del texto visible (accessibleName). */
  label: string;
  /** Texto del botón. */
  triggerLabel: string;
  /** El botón se ve elegido (data-active), como los chips de la barra. */
  active: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Título del panel (accesible), arriba del contenido. */
  title: string;
  children: ReactNode;
};

/** Botón de filtro de la barra (como el de `base/Select`) que abre un panel debajo, con contenido libre. */
const Popover = (props: Props) => (
  <PopoverBase.Root open={props.open} onOpenChange={(open) => props.onOpenChange?.(open)}>
    <PopoverBase.Trigger className={styles.trigger} aria-label={accessibleName(props.triggerLabel, props.label)} data-active={props.active ? "" : undefined}>
      {props.triggerLabel}
      <ChevronDown className={styles.icon} width={10} height={10} aria-hidden />
    </PopoverBase.Trigger>
    <PopoverBase.Portal>
      <PopoverBase.Positioner className={styles.positioner} sideOffset={4} align="start">
        <PopoverBase.Popup className={styles.popup}>
          <PopoverBase.Title className={styles.title}>{props.title}</PopoverBase.Title>
          {props.children}
        </PopoverBase.Popup>
      </PopoverBase.Positioner>
    </PopoverBase.Portal>
  </PopoverBase.Root>
);

export default Popover;
