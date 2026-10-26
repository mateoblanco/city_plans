"use client";

import { Toggle } from "@base-ui/react/toggle";
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
    <Toggle
      className={styles.like}
      pressed={liked}
      onPressedChange={() => toggleLike(props.placeId)}
      aria-label={liked ? `Quitar me gusta de ${props.name}` : `Me gusta ${props.name}`}
    >
      <svg className={styles.heart} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20.5s-7.5-4.6-9.4-9.3C1.3 7.9 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 3 1.5-1.9 3.1-3 5.1-3 3.5 0 5.6 3.4 4.3 6.7-1.9 4.7-9.4 9.3-9.4 9.3z" />
      </svg>
    </Toggle>
  );
};

export default LikeButton;
