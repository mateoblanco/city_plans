import { Suspense } from "react";
import ArrowExternal from "@/assets/arrow_external.svg";
import Star from "@/assets/star.svg";
import type { OpenStateText } from "@/server/search/labels";
import type { PriceText, RatingInfo } from "../utils/summary";
import PlaceTags from "./PlaceTags/PlaceTags";
import styles from "./PlaceSummary.module.scss";

type Props = {
  name: string;
  /**
   * Estado de horario con los textos de la PlaceCard (placeOpenText); null si no se sabe (no se muestra). Una promesa
   * cuando depende de Google (la base no tiene horarios confirmados): la línea queda reservada hasta que llega.
   */
  status: OpenStateText | null | Promise<OpenStateText | null>;
  category: string | null;
  /** "$$ (Normal)" y "Precio: normal" para lectores de pantalla; null con precio desconocido. */
  price: PriceText | null;
  /** Puntaje de Google ("4,6", "1.230" reseñas y el link), como promesa (llega con Google); null si no está en Google. */
  rating: Promise<RatingInfo | null> | null;
  description: string | null;
  /** Chips de dietas y tags (placeChips). */
  chips: string[];
  instagram: string | null;
};

// La línea de estado: más alta que la de datos por el fondo del estado; reservada (vacía) mide lo mismo.
const STATUS_LINE = `${styles.facts} ${styles.statusFacts}`;

const Separator = () => <span className={styles.separator} aria-hidden />;

type StatusProps = { status: OpenStateText | null };

/** "Abierto Cierra 00:00": el estado con el color y el fondo del tono y, sin separador, su horario (cerrado, sin él). */
const Status = (props: StatusProps) =>
  props.status ? (
    <span className={styles.fact}>
      <span className={styles.status} data-tone={props.status.tone}>
        {props.status.status}
      </span>
      {/* Cerrado va sin la próxima apertura ("Abre el miércoles 16:30"): la semana está en los horarios. */}
      {props.status.tone !== "closed" && props.status.detail}
    </span>
  ) : null;

type GoogleStatusProps = { status: Promise<OpenStateText | null> };

/** El estado que depende de Google; sin respuesta no se muestra (la línea ya tiene su alto). */
const GoogleStatus = async (props: GoogleStatusProps) => <Status status={await props.status} />;

type RatingTextProps = { rating: RatingInfo };

/** "★ 4,4 (1.230) en Google". */
const RatingText = (props: RatingTextProps) => (
  <>
    <Star className={styles.star} aria-hidden width={14} height={13} />
    <span>
      {props.rating.value}
      {props.rating.count && ` (${props.rating.count})`} en Google
    </span>
  </>
);

/** preceded: hay tipo o precio antes (lleva separador). */
type RatingProps = { rating: Promise<RatingInfo | null>; preceded: boolean };

/**
 * "· ★ 4,4 (1.230) en Google ↗", al final de la línea (así aparecer no corre nada de lo de antes). Todo es un link a
 * las reseñas en Google Maps, en otra pestaña.
 */
const Rating = async (props: RatingProps) => {
  const rating = await props.rating;
  if (!rating) return null;
  const count = rating.count ? ` ${rating.count} reseñas.` : "";
  return (
    <span className={styles.fact}>
      {props.preceded && <Separator />}
      {rating.href ? (
        <a className={styles.ratingLink} href={rating.href} target="_blank" rel="noopener noreferrer">
          <RatingText rating={rating} />
          <span className={styles.visuallyHidden}>{`:${count} Ver en Google Maps (se abre en otra pestaña)`}</span>
          <ArrowExternal className={styles.external} aria-hidden width={8} height={8} />
        </a>
      ) : (
        <span className={styles.rating}>
          <RatingText rating={rating} />
        </span>
      )}
    </span>
  );
};

/** Lugar del puntaje mientras llega Google: un texto invisible del mismo largo, así la línea ya tiene su ancho. */
const RatingReserve = (props: { preceded: boolean }) => (
  <span className={`${styles.fact} ${styles.reserve}`} aria-hidden>
    {props.preceded && <span className={styles.separator} />}
    <span className={styles.ratingLink}>
      <RatingText rating={{ value: "4,6", count: "1.230", href: null }} />
      <ArrowExternal className={styles.external} width={8} height={8} />
    </span>
  </span>
);

/**
 * Nombre, la línea de tipo · precio · puntaje, la de estado y horario, la descripción y los chips. Lo de la base sale
 * enseguida; el puntaje (y el estado, si la base no tiene horarios confirmados) llega de Google en su Suspense, con el
 * lugar ya reservado.
 */
const PlaceSummary = (props: Props) => {
  const description = props.description?.trim();
  const pendingStatus = props.status instanceof Promise ? props.status : null;
  const status = pendingStatus ? null : (props.status as OpenStateText | null);

  // Dos líneas, con " · " sólo entre tramos que están (sin tipo, puntaje o precio no queda un separador suelto).
  // Arriba: tipo · precio ("$$ (Normal)"; los lectores de pantalla leen "Precio: normal") · puntaje.
  const preceded = !!(props.category || props.price);
  const ratingLine =
    props.category || props.rating || props.price ? (
      <p className={styles.facts}>
        {props.category && <span className={styles.fact}>{props.category}</span>}
        {props.price && (
          <span className={styles.fact}>
            {props.category && <Separator />}
            <span aria-hidden>{`${props.price.signs} (${props.price.level})`}</span>
            <span className={styles.visuallyHidden}>{props.price.label}</span>
          </span>
        )}
        {props.rating && (
          <Suspense fallback={<RatingReserve preceded={preceded} />}>
            <Rating rating={props.rating} preceded={preceded} />
          </Suspense>
        )}
      </p>
    ) : null;

  // Abajo: el estado y su horario; si depende de Google, la línea queda reservada hasta que llega.
  const statusLine = pendingStatus ? (
    <p className={STATUS_LINE}>
      <Suspense fallback={null}>
        <GoogleStatus status={pendingStatus} />
      </Suspense>
    </p>
  ) : status ? (
    <p className={STATUS_LINE}>
      <Status status={status} />
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
