"use client";

import CardToggle from "../CardToggle/CardToggle";
import styles from "./SaveButton.module.scss";
import { toggleSaved, useIsSaved } from "../../../utils/saved";
import type { EventOrigin } from "@shared/events.ts";
import { track } from "@/components/Tracking/utils/track";
import { trackSaveToggle } from "@/components/ProductAnalytics/utils/saved";

type Props = {
  placeId: string;
  slug: string;
  name: string;
  /** Origen de la card, para el evento de guardar. */
  origin: EventOrigin;
  originRow?: string;
  /** Área táctil de 44×44 sin cambiar el tamaño visible (en la guía). */
  touchTarget?: boolean;
};

/**
 * Corazón de la card: guarda o saca el lugar (sólo en el navegador, con la fecha). Los guardados salen en "Guardados" de
 * la home y son la señal de gustos del perfil; no vuelve a buscar: lo usa la búsqueda siguiente. Sin localStorage no se
 * muestra.
 */
const SaveButton = (props: Props) => {
  const saved = useIsSaved(props.placeId);
  if (!saved.available) return null;
  const isSaved = saved.active;

  return (
    <CardToggle
      active={isSaved}
      label={`Guardar ${props.name}`}
      tooltip={isSaved ? "Guardado" : "Guardar"}
      touchTarget={props.touchTarget}
      // Máscara de CSS y no un <svg> inline: hay un corazón por card y la home tiene decenas.
      icon={<span className={styles.heart} data-saved={isSaved || undefined} aria-hidden />}
      onToggle={() => {
        if (!toggleSaved(props.placeId)) return;
        track(props.placeId, isSaved ? "unsave" : "save", { origin: props.origin, row: props.originRow ?? null });
        trackSaveToggle({ id: props.placeId, slug: props.slug }, !isSaved, props.origin);
      }}
    />
  );
};

export default SaveButton;
