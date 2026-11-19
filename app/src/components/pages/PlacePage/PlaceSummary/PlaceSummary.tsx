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
  category: string | null;
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

const Separator = () => <span className={styles.separator} aria-hidden />;

/**
 * Nombre, la línea de tipo · precio · puntaje, la de estado y horario, la descripción y los chips. Lo de la base sale en
 * el HTML del servidor; el puntaje (y el estado, si Google lo cambia) llega después desde el navegador, con el lugar ya
 * reservado.
 */
const PlaceSummary = (props: Props) => {
  const description = props.description?.trim();

  // Dos líneas, con " · " sólo entre tramos que están (sin tipo, puntaje o precio no queda un separador suelto).
  // Arriba: tipo · precio ("$$ (Normal)"; los lectores de pantalla leen "Precio: normal") · puntaje.
  const preceded = !!(props.category || props.price);
  const ratingLine =
    props.category || props.google || props.price ? (
      <p className={styles.facts}>
        {props.category && <span className={styles.fact}>{props.category}</span>}
        {props.price && (
          <span className={styles.fact}>
            {props.category && <Separator />}
            <span aria-hidden>{`${props.price.signs} (${props.price.level})`}</span>
            <span className={styles.visuallyHidden}>{props.price.label}</span>
          </span>
        )}
        {props.google && <PlaceRating preceded={preceded} fallbackHref={props.google.fallbackHref} />}
      </p>
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

        {(ratingLine || statusLine) && (
          <div className={styles.factLines}>
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
