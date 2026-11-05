import styles from "./PlaceTags.module.scss";

type Props = {
  /** Dietas y tags del lugar, ya en español (placeChips). */
  chips: string[];
};

/** Chips (no clickeables) con dietas y tags. Sin chips, no se muestra. */
const PlaceTags = (props: Props) => {
  if (props.chips.length === 0) return null;

  return (
    <ul className={styles.chips}>
      {props.chips.map((chip) => (
        <li key={chip} className={styles.chip}>{chip}</li>
      ))}
    </ul>
  );
};

export default PlaceTags;
