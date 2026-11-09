"use client";

import Heart from "@/assets/heart.svg";
import HeartFill from "@/assets/heart_fill.svg";
import CardToggle from "../CardToggle/CardToggle";
import styles from "./LikeButton.module.scss";
import { toggleLike, useLiked } from "../../../utils/likes";

type Props = {
  placeId: string;
  name: string;
};

/**
 * Corazón de la card: guarda o saca el id del lugar (sólo en el navegador). No vuelve a buscar: lo usa la búsqueda
 * siguiente. Sin localStorage no se muestra.
 */
const LikeButton = (props: Props) => {
  const like = useLiked(props.placeId);
  if (!like.available) return null;
  const liked = like.active;

  return (
    <CardToggle
      active={liked}
      label={liked ? `Quitar me gusta de ${props.name}` : `Me gusta ${props.name}`}
      icon={liked ? <HeartFill className={styles.heartLiked} aria-hidden /> : <Heart aria-hidden />}
      onToggle={() => toggleLike(props.placeId)}
    />
  );
};

export default LikeButton;
