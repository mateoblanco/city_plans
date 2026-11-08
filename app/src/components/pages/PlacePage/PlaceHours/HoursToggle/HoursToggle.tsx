"use client";

import { useState, type ReactNode } from "react";
import Button from "@/components/base/Button/Button";
import styles from "./HoursToggle.module.scss";

type Props = {
  /** La lista de días (PlaceHours): se renderiza una sola vez, el CSS decide qué filas se ven. */
  children: ReactNode;
};

/**
 * data-hours-expanded lo lee PlaceHours.module.scss. Mobile: los horarios muestran sólo hoy ("Hoy · 10:00 – 20:00") y "Ver todos" despliega la semana ("Ver menos" la
 * cierra). Desde md siempre se ve la semana y el botón no está (PlaceHours.module.scss, HoursToggle.module.scss).
 */
const HoursToggle = (props: Props) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={styles.toggle} data-hours-expanded={expanded || undefined}>
      {props.children}
      <div className={styles.action}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          label={expanded ? "Ver menos" : "Ver todos"}
          onClick={() => setExpanded((current) => !current)}
        />
      </div>
    </div>
  );
};

export default HoursToggle;
