"use client";

import { useEffect, useState } from "react";
import PlaceStatus from "@/components/pages/PlacePage/PlaceSummary/PlaceStatus/PlaceStatus";
import { montevideoMinuteOfWeek, statusAt, type WeekStatus } from "@/lib/week-status";
import type { OpenStateText } from "@/server/search/labels";
import styles from "./GuideStatus.module.scss";

type Props = {
  status: WeekStatus;
};

/**
 * "Abierto Cierra 20:00", con los textos de la ficha (los arma el servidor para toda la semana). Se elige en el
 * navegador con la hora de Montevideo, después de hidratar: el HTML cacheado no trae estado y no puede quedar viejo. Se
 * actualiza cada minuto y al volver a la pestaña. Sin horario confirmado, nada (la línea queda reservada).
 */
const GuideStatus = (props: Props) => {
  const [status, setStatus] = useState<OpenStateText | null>(null);

  useEffect(() => {
    const update = () => setStatus(statusAt(props.status, montevideoMinuteOfWeek()));
    update();
    const timer = setInterval(update, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [props.status]);

  return (
    <span className={styles.status}>
      <PlaceStatus status={status} />
    </span>
  );
};

export default GuideStatus;
