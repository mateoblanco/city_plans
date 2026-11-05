import Button from "@/components/base/Button/Button";
import styles from "./PlaceLocation.module.scss";
import ArrowExternal from "@/assets/arrow_external.svg";

type Props = {
  /** De Google; null si no vino. */
  address: string | null;
  neighborhood: string;
  locatedIn: string | null;
  /** Link a Google Maps por place_id; null sin place_id. */
  mapsHref: string | null;
};

/** Debajo del mapa: dirección, barrio, venue y "Ver en Google Maps". */
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
  </div>
);

export default PlaceLocation;
