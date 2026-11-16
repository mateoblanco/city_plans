import { Suspense } from "react";
import Button from "@/components/base/Button/Button";
import styles from "./PlaceLocation.module.scss";
import ArrowExternal from "@/assets/arrow_external.svg";
import TransitLines from "./TransitLines/TransitLines";
import DirectionsTracker from "@/components/Tracking/DirectionsTracker/DirectionsTracker";

type Props = {
  /** De Google, como promesa (llega después de lo de la base); null si el lugar no está en Google. */
  address: Promise<string | null> | null;
  neighborhood: string;
  locatedIn: string | null;
  /** Líneas de ómnibus con parada cerca, sin repetir; vacío si no hay. */
  lines: string[];
  /** Link a Google Maps por place_id; null sin place_id. */
  mapsHref: string | null;
  /** Con TRACK_EVENTS: el id del lugar, y el click en "Google Maps" cuenta como "Cómo llegar". null: sin eventos. */
  trackPlaceId: string | null;
};

type AddressProps = { address: Promise<string | null> };

/** La calle de Google; si no vino, la línea reservada queda vacía (no sube lo de abajo). */
const Address = async (props: AddressProps) => {
  const address = await props.address;
  return address ? <p className={styles.address}>{address}</p> : <p className={styles.address} aria-hidden />;
};

/** Debajo del mapa: dirección, barrio, venue, "Ver en Google Maps" y las líneas de ómnibus cercanas. */
const PlaceLocation = (props: Props) => (
  <div className={styles.location}>
    <div className={styles.lines}>
      {props.address && (
        <Suspense fallback={<p className={styles.address} aria-hidden />}>
          <Address address={props.address} />
        </Suspense>
      )}
      <p className={styles.address}>Montevideo, {props.neighborhood}</p>
      {props.locatedIn && <p className={styles.venue}>Dentro de {props.locatedIn}</p>}
    </div>
    {props.mapsHref && (
      <div className={styles.actions}>
        {props.trackPlaceId ? (
          <DirectionsTracker placeId={props.trackPlaceId}>
            <Button href={props.mapsHref} external label="Google Maps" variant="tertiary" size="sm" iconEnd={<ArrowExternal aria-hidden width={8} height={8} />} />
          </DirectionsTracker>
        ) : (
          <Button href={props.mapsHref} external label="Google Maps" variant="tertiary" size="sm" iconEnd={<ArrowExternal aria-hidden width={8} height={8} />} />
        )}
      </div>
    )}
    {props.lines.length > 0 && <TransitLines lines={props.lines} />}
  </div>
);

export default PlaceLocation;
