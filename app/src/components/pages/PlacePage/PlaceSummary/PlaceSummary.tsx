import Money from "@/assets/money.svg";
import type { OpenStateText } from "@/server/search/labels";
import type { PriceText } from "../utils/summary";
import GoogleStatus from "./GoogleStatus/GoogleStatus";
import PlaceRating from "./PlaceRating/PlaceRating";
import PlaceStatus from "./PlaceStatus/PlaceStatus";
import PlaceTags from "./PlaceTags/PlaceTags";
import styles from "./PlaceSummary.module.scss";

type Props = {
  name: string;
  /** Estado de los horarios de la base con los textos de la PlaceCard (placeOpenText sin Google); null si no se sabe. */
  status: OpenStateText | null;
  /** "$$ (Normal)" y "Precio: normal" para lectores de pantalla; null con precio desconocido. */
  price: PriceText | null;
  /**
   * El lugar está en Google (tiene google_place_id): el puntaje y el estado de Google llegan desde el navegador
   * (PlaceGoogle), con su lugar reservado. fallbackHref: el link de Google Maps si Google no trae el de las reseñas.
   * null: no está en Google, no se reserva nada.
   */
  google: { fallbackHref: string | null } | null;
  description: string | null;
  /** Chips de dietas y tags (placeChips). */
  chips: string[];
  instagram: string | null;
};

// La línea de estado: más alta que la de datos por el fondo del estado; reservada (vacía) mide lo mismo.
const STATUS_LINE = `${styles.facts} ${styles.statusFacts}`;

/**
 * Nombre, la línea de precio, la del puntaje de Google, la de estado y horario, la descripción y los chips. Lo de la base sale en
 * el HTML del servidor; el puntaje (y el estado, si Google lo cambia) llega después desde el navegador, con el lugar ya
 * reservado.
 */
const PlaceSummary = (props: Props) => {
  const description = props.description?.trim();

  // Hasta tres líneas. Arriba: el ícono de plata y el precio ("$$ (Normal)"; los lectores de pantalla leen "Precio: normal"). El tipo de
  // lugar no se muestra.
  const typeLine = props.price ? (
    <p className={styles.facts}>
      <span className={styles.price}>
        <span className={styles.iconBox} aria-hidden>
          <Money className={styles.priceIcon} width={20} height={20} />
        </span>
        <span aria-hidden>{`${props.price.signs} (${props.price.level})`}</span>
        <span className={styles.visuallyHidden}>{props.price.label}</span>
      </span>
    </p>
  ) : null;

  // En el medio: el puntaje de Google, en su línea (PlaceRating la reserva mientras llega).
  const ratingLine = props.google ? (
    <PlaceRating className={styles.facts} fallbackHref={props.google.fallbackHref} />
  ) : null;

  // Abajo: el estado y su horario. En Google la línea está siempre (alto fijo): cuando llega, sólo cambia el texto.
  const statusLine = props.google ? (
    <p className={STATUS_LINE}>
      <GoogleStatus base={props.status} />
    </p>
  ) : props.status ? (
    <p className={STATUS_LINE}>
      <PlaceStatus status={props.status} />
    </p>
  ) : null;

  return (
    <div className={styles.summary}>
      <div className={styles.main}>
        <h1 className={styles.name}>{props.name}</h1>

        {(typeLine || ratingLine || statusLine) && (
          <div className={styles.factLines}>
            {typeLine}
            {ratingLine}
            {statusLine}
          </div>
        )}
      </div>

      {description && <p className={styles.description}>{description}</p>}

      <PlaceTags chips={props.chips} />
    </div>
  );
};

export default PlaceSummary;
