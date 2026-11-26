import Money from "@/assets/money.svg";
import BankChip from "@/components/BankChip/BankChip";
import type { OpenStateText } from "@/server/search/labels";
import type { PlaceChip } from "../utils/place-options";
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
  chips: PlaceChip[];
  instagram: string | null;
  /** Bancos con algún descuento en el lugar, en el orden de la config; vacío, no hay línea. */
  discounts: { id: string; name: string }[];
};

// La línea de estado: más alta que la de datos por el fondo del estado; reservada (vacía) mide lo mismo.
const STATUS_LINE = `${styles.facts} ${styles.statusFacts}`;

/**
 * Nombre, la línea de precio, la del puntaje de Google, la de estado y horario, la de los bancos con descuento, la descripción y los chips. Lo de la base sale en
 * el HTML del servidor; el puntaje (y el estado, si Google lo cambia) llega después desde el navegador, con el lugar ya
 * reservado.
 */
const PlaceSummary = (props: Props) => {
  const description = props.description?.trim();

  // Hasta cuatro líneas. Arriba: el ícono de plata y el precio ("$$ (Normal)"; los lectores de pantalla leen "Precio: normal"). El tipo de
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

  // Debajo del estado: el chip de cada banco con descuento, con su ícono como en la card (el detalle va en "Descuentos").
  const discountLine =
    props.discounts.length > 0 ? (
      <div className={styles.facts}>
        <span className={styles.visuallyHidden}>Descuentos con:</span>
        <span className={styles.banks}>
          {props.discounts.map((provider) => (
            <BankChip key={provider.id} id={provider.id} name={provider.name} size="sm" icon />
          ))}
        </span>
      </div>
    ) : null;

  return (
    <div className={styles.summary}>
      <div className={styles.main}>
        <h1 className={styles.name}>{props.name}</h1>

        {(typeLine || ratingLine || statusLine || discountLine) && (
          <div className={styles.factLines}>
            {typeLine}
            {ratingLine}
            {statusLine}
            {discountLine}
          </div>
        )}
      </div>

      {description && <p className={styles.description}>{description}</p>}

      <PlaceTags chips={props.chips} />
    </div>
  );
};

export default PlaceSummary;
