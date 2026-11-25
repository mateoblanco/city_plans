"use client";

import ArrowExternal from "@/assets/arrow_external.svg";
import Star from "@/assets/star.svg";
import { usePlaceGoogle } from "../../PlaceGoogle/utils/context";
import { ratingInfo, type RatingInfo } from "../../utils/rating";
import styles from "./PlaceRating.module.scss";

type Props = {
  /** La clase de la línea (la de datos de PlaceSummary): el puntaje va solo en su línea. */
  className: string;
  /** Sin link de reseñas de Google, el link general del lugar en Google Maps. */
  fallbackHref: string | null;
};

type RatingTextProps = { rating: RatingInfo };

/** "★ 4,4 (1.230) en Google". */
const RatingText = (props: RatingTextProps) => (
  <>
    <span className={styles.iconBox} aria-hidden>
      <Star className={styles.star} width={16} height={16} />
    </span>
    <span>
      {props.rating.value}
      {props.rating.count && ` (${props.rating.count})`} en Google
    </span>
  </>
);

type ReserveProps = { className: string };

/** Lugar del puntaje mientras llega Google: la línea con un texto invisible, así ya tiene su alto. */
const RatingReserve = (props: ReserveProps) => (
  <p className={props.className} aria-hidden>
    <span className={`${styles.ratingLink} ${styles.reserve}`}>
      <RatingText rating={{ value: "4,6", count: "1.230", href: null }} />
      <ArrowExternal className={styles.external} width={8} height={8} />
    </span>
  </p>
);

/**
 * "★ 4,4 (1.230) en Google ↗", en su propia línea (entre tipo · precio y el estado). Todo es un link a las reseñas en
 * Google Maps, en otra pestaña. Mientras llega Google, la línea reservada; sin puntaje, no hay línea.
 */
const PlaceRating = (props: Props) => {
  const google = usePlaceGoogle();
  if (google.status === "pending") return <RatingReserve className={props.className} />;
  const rating = google.status === "ready" ? ratingInfo(google.info, props.fallbackHref) : null;
  if (!rating) return null;
  const count = rating.count ? ` ${rating.count} reseñas.` : "";
  return (
    <p className={props.className}>
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
    </p>
  );
};

export default PlaceRating;
