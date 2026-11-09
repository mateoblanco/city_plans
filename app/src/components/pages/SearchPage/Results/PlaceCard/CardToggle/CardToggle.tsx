"use client";

import type { ReactElement } from "react";
import Button from "@/components/base/Button/Button";
import styles from "./CardToggle.module.scss";

type Props = {
  active: boolean;
  /** Nombre accesible (el botón es sólo ícono): fijo; el estado va en aria-pressed. */
  label: string;
  icon: ReactElement;
  onToggle: () => void;
};

/**
 * Botón de ícono de la card que prende o apaga algo del lugar (me gusta, guardar): aparece al pasar el mouse por la card,
 * con foco de teclado o si está activo; en touch, siempre. Queda por encima del link que cubre la card.
 */
const CardToggle = (props: Props) => (
  <span className={styles.toggle} data-active={props.active || undefined}>
    <Button
      type="button"
      variant="tertiary"
      size="sm"
      onlyIcon
      label={props.label}
      pressed={props.active}
      icon={props.icon}
      onClick={props.onToggle}
    />
  </span>
);

export default CardToggle;
