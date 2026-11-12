"use client";

import Heart from "@/assets/heart.svg";
import HeartFill from "@/assets/heart_fill.svg";
import CardToggle from "../CardToggle/CardToggle";
import styles from "./SaveButton.module.scss";
import { toggleSaved, useIsSaved } from "../../../utils/saved";

type Props = {
  placeId: string;
  name: string;
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
      icon={isSaved ? <HeartFill className={styles.heartSaved} aria-hidden /> : <Heart aria-hidden />}
      onToggle={() => toggleSaved(props.placeId)}
    />
  );
};

export default SaveButton;
