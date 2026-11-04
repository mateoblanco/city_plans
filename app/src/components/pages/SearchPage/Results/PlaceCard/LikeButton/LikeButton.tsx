"use client";

import Button from "@/components/base/Button/Button";
import Heart from "@/assets/heart.svg";
import HeartFill from "@/assets/heart_fill.svg";
import styles from "./LikeButton.module.scss";
import { toggleLike, useLikes } from "../../../utils/likes";

type Props = {
  placeId: string;
  name: string;
};

/**
 * Corazón de la card: guarda o saca el id del lugar (sólo en el navegador). No vuelve a buscar: lo usa la búsqueda
 * siguiente. Sin localStorage no se muestra.
 */
const LikeButton = (props: Props) => {
  const likes = useLikes();
  if (!likes.available) return null;
  const liked = likes.ids.includes(props.placeId);

  return (
    <span className={styles.like} data-liked={liked || undefined}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onlyIcon
        label={liked ? `Quitar me gusta de ${props.name}` : `Me gusta ${props.name}`}
        pressed={liked}
        icon={liked ? <HeartFill className={styles.heartLiked} aria-hidden /> : <Heart aria-hidden />}
        onClick={() => toggleLike(props.placeId)}
      />
    </span>
  );
};

export default LikeButton;
