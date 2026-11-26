import Button from "@/components/base/Button/Button";
import styles from "./PlaceLocation.module.scss";
import ArrowExternal from "@/assets/arrow_external.svg";
import TransitLines from "./TransitLines/TransitLines";
import DirectionsTracker from "@/components/Tracking/DirectionsTracker/DirectionsTracker";
import PlaceAddress from "./PlaceAddress/PlaceAddress";
import { trackAttrs } from "@/lib/product-analytics/track";

type Props = {
  /** El lugar está en Google: la calle llega desde el navegador (PlaceAddress), con la línea reservada. */
  inGoogle: boolean;
  neighborhood: string;
  locatedIn: string | null;
  /** Líneas de ómnibus con parada cerca, sin repetir; vacío si no hay. */
  lines: string[];
  /** Link a Google Maps por place_id; null sin place_id. */
  mapsHref: string | null;
  /** Con TRACK_EVENTS: el id del lugar, y el click en "Google Maps" cuenta como "Cómo llegar". null: sin eventos. */
  trackPlaceId: string | null;
  /** Para la analítica de producto (directions_clicked). */
  place: { id: string; slug: string };
};

/** Debajo del mapa: dirección, barrio, venue, "Ver en Google Maps" y las líneas de ómnibus cercanas. */
const PlaceLocation = (props: Props) => (
  <div className={styles.location}>
    <div className={styles.lines}>
      {props.inGoogle && <PlaceAddress />}
      <p className={styles.address}>Montevideo, {props.neighborhood}</p>
      {props.locatedIn && <p className={styles.venue}>Dentro de {props.locatedIn}</p>}
    </div>
    {props.mapsHref && (
      <div className={styles.actions} {...trackAttrs("directions_clicked", { place_id: props.place.id, slug: props.place.slug })}>
        {props.trackPlaceId ? (
          <DirectionsTracker placeId={props.trackPlaceId}>
            <Button href={props.mapsHref} external label="Google Maps" variant="ghost" size="sm" iconEnd={<ArrowExternal aria-hidden width={8} height={8} />} />
          </DirectionsTracker>
        ) : (
          <Button href={props.mapsHref} external label="Google Maps" variant="ghost" size="sm" iconEnd={<ArrowExternal aria-hidden width={8} height={8} />} />
        )}
      </div>
    )}
    {props.lines.length > 0 && <TransitLines lines={props.lines} />}
  </div>
);

export default PlaceLocation;
