import Button from "@/components/base/Button/Button";
import styles from "./PlaceLocation.module.scss";
import ArrowExternal from "@/assets/arrow_external.svg";
import { linePill } from "./utils/line-color";

type Props = {
  /** De Google; null si no vino. */
  address: string | null;
  neighborhood: string;
  locatedIn: string | null;
  /** Líneas de ómnibus con parada cerca, sin repetir; vacío si no hay. */
  lines: string[];
  /** Link a Google Maps por place_id; null sin place_id. */
  mapsHref: string | null;
};

/** Debajo del mapa: dirección, barrio, venue, "Ver en Google Maps" y las líneas de ómnibus cercanas. */
const PlaceLocation = (props: Props) => (
  <div className={styles.location}>
    <div className={styles.lines}>
      {props.address && <p className={styles.address}>{props.address}</p>}
      <p className={styles.address}>Montevideo, {props.neighborhood}</p>
      {props.locatedIn && <p className={styles.venue}>Dentro de {props.locatedIn}</p>}
    </div>
    {props.mapsHref && (
      <div className={styles.actions}>
        <Button href={props.mapsHref} external label="Google Maps" variant="tertiary" size="sm" iconEnd={<ArrowExternal aria-hidden width={8} height={8}  />} />
      </div>
    )}
    {props.lines.length > 0 && (
      <div className={styles.transit}>
        <p className={styles.transitLabel}>Ómnibus cerca</p>
        <ul className={styles.chips} aria-label="Líneas de ómnibus cercanas">
          {props.lines.map((line) => {
            const pill = linePill(line);
            return (
              <li key={line} className={pill ? styles.chip : `${styles.chip} ${styles.unknown}`} style={pill ? { backgroundColor: pill.background, color: pill.color } : undefined}>
                {line}
              </li>
            );
          })}
        </ul>
      </div>
    )}
  </div>
);

export default PlaceLocation;
