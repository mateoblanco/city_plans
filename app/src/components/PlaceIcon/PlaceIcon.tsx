import { iconEmoji, type IconCategory } from "@shared/icon-categories.ts";
import styles from "./PlaceIcon.module.scss";

type Props = {
  /** Clave de shared/icon-categories.ts; null o desconocida → 🍽️. */
  category: IconCategory | null;
};

/** Ícono de la categoría del lugar. Único lugar de la app que dibuja el emoji (después van SVGs). */
const PlaceIcon = (props: Props) => (
  <span className={styles.icon} aria-hidden="true">
    {iconEmoji(props.category)}
  </span>
);

export default PlaceIcon;
