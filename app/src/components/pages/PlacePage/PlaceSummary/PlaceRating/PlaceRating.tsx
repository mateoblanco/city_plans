"use client";

import ArrowExternal from "@/assets/arrow_external.svg";
import Star from "@/assets/star.svg";
import { usePlaceGoogle } from "../../PlaceGoogle/utils/context";
import { ratingInfo, type RatingInfo } from "../../utils/rating";
import styles from "./PlaceRating.module.scss";

type Props = {
  /** Hay tipo o precio antes (lleva separador). */
  preceded: boolean;
  /** Sin link de reseñas de Google, el link general del lugar en Google Maps. */
  fallbackHref: string | null;
};

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

type PrecededProps = { preceded: boolean };

/** Lugar del puntaje mientras llega Google: un texto invisible del mismo largo, así la línea ya tiene su ancho. */
const RatingReserve = (props: PrecededProps) => (
  <span className={`${styles.fact} ${styles.reserve}`} aria-hidden>
    {props.preceded && <span className={styles.separator} />}
    <span className={styles.ratingLink}>
      <RatingText rating={{ value: "4,6", count: "1.230", href: null }} />
      <ArrowExternal className={styles.external} width={8} height={8} />
    </span>
  </span>
);

/**
 * "· ★ 4,4 (1.230) en Google ↗", al final de la línea de tipo y precio (así aparecer no corre nada de lo de antes). Todo
 * es un link a las reseñas en Google Maps, en otra pestaña. Mientras llega Google, el hueco reservado; sin puntaje, nada.
 */
const PlaceRating = (props: Props) => {
  const google = usePlaceGoogle();
  if (google.status === "pending") return <RatingReserve preceded={props.preceded} />;
  const rating = google.status === "ready" ? ratingInfo(google.info, props.fallbackHref) : null;
  if (!rating) return null;
  const count = rating.count ? ` ${rating.count} reseñas.` : "";
  return (
    <span className={styles.fact}>
      {props.preceded && <span className={styles.separator} aria-hidden />}
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

export default PlaceRating;
