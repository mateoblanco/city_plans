"use client";

import { usePlaceGoogle } from "../PlaceGoogle/utils/context";
import PlaceContact from "../PlaceContact/PlaceContact";
import PlaceHours from "../PlaceHours/PlaceHours";
import PlaceInfoCard from "../PlaceInfoCard/PlaceInfoCard";
import styles from "./PlaceInfo.module.scss";

/** Una semana de mentira para reservar el alto de los horarios mientras llega Google (invisible). */
const RESERVED_WEEK = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, ranges: ["12:00 – 00:00"], allDay: false }));

type Props = {
  instagramHandle: string | null;
  popularHref: string | null;
  /** Día de hoy en Montevideo (0 = domingo). */
  today: number;
};

/**
 * Contacto (lo de la base y la web y el WhatsApp de Google) y los horarios de Google, en una tarjeta. Lo de Google llega
 * desde el navegador (PlaceGoogle): mientras tanto, el contacto de la base y el lugar de los horarios ya reservado
 * (invisible, sin foco), con el alto del caso común (un turno por día), así cuando llegan lo de abajo casi no se mueve.
 * Sin Google (no está, bot, límite o error), sólo lo de la base.
 */
const PlaceInfo = (props: Props) => {
  const google = usePlaceGoogle();
  const info = google.status === "ready" ? google.info : null;
  return (
    <PlaceInfoCard>
      <PlaceContact
        bare
        instagramHandle={props.instagramHandle}
        popularHref={props.popularHref}
        website={info?.website ?? null}
        whatsappHref={info?.whatsappHref ?? null}
      />
      {google.status === "pending" && (
        <div className={styles.reserve} data-bare aria-hidden inert>
          <PlaceHours bare week={RESERVED_WEEK} today={props.today} />
        </div>
      )}
      {info?.week && <PlaceHours bare week={info.week} today={props.today} />}
    </PlaceInfoCard>
  );
};

export default PlaceInfo;
