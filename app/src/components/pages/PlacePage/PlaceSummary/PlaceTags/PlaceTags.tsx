import type { PlaceChip } from "../../utils/place-options";
import { TAG_ICONS } from "./utils/tag-icons";
import styles from "./PlaceTags.module.scss";

type Props = {
  /** Dietas y tags del lugar, ya en español, con su id para el ícono (placeChips). */
  chips: PlaceChip[];
};

/** Chips (no clickeables) con dietas y tags, cada uno con su ícono a la izquierda. Sin chips, no se muestra. */
const PlaceTags = (props: Props) => {
  if (props.chips.length === 0) return null;

  return (
    <ul className={styles.chips}>
      {props.chips.map((chip) => {
        const Icon = TAG_ICONS[chip.id];
        return (
          <li key={chip.id} className={styles.chip}>
            {Icon && <Icon className={styles.icon} width={16} height={16} aria-hidden />}
            {chip.label}
          </li>
        );
      })}
    </ul>
  );
};

export default PlaceTags;
