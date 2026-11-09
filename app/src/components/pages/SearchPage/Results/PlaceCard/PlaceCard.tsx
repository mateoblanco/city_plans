"use client";

import { memo } from "react";
import Link from "next/link";
import { label } from "@shared/tags.ts";
import type { SearchResult } from "@/server/search";
import type { KeptBy } from "@/server/search/relevance";
import PlaceImage from "./PlaceImage/PlaceImage";
import LikeButton from "./LikeButton/LikeButton";
import SaveButton from "./SaveButton/SaveButton";
import CardDiscounts from "./CardDiscounts/CardDiscounts";
import { cardId, useIsHovered, useSetHovered } from "../../utils/hover";
import styles from "./PlaceCard.module.scss";

/** Sólo con ?debug=1: puntajes, similitud semántica con la consulta y por qué pasó el corte por relevancia. */
export type CardDebug = { score: number; baseScore: number; multiplier: number; similarity: number | null; keptBy: KeptBy | null; pinned: boolean };

const KEPT_LABELS: Record<KeptBy, string> = {
  pinned: "por nombre",
  category: "por categoría",
  tag: "por tag",
  moment: "por momento",
  dish: "por plato",
  keyword: "por keyword",
  venue: "por venue",
  intent: "por intención",
  similar: "por similitud",
  "no-similarity": "sin similitud",
};

const number = (value: number) => value.toLocaleString("es-UY", { maximumSignificantDigits: 3 });

const debugLine = ({ score, baseScore, multiplier, similarity, keptBy, pinned }: CardDebug) =>
  [
    `puntaje ${number(score)}`,
    `relevancia ${number(baseScore)}`,
    `×${multiplier.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    similarity === null ? null : `sim ${similarity.toLocaleString("es-UY", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`,
    keptBy && keptBy !== "pinned" ? KEPT_LABELS[keptBy] : null,
    pinned ? "fijado" : null,
  ]
    .filter(Boolean)
    .join(" · ");

type Props = {
  place: SearchResult;
  debug?: CardDebug;
};

/** Tarjeta de un resultado, con el hover sincronizado con su marcador. */
const PlaceCard = (props: Props) => {
  // Sólo si es ESTA card la del hover: al pasar el mouse por otra, esta no se re-renderiza.
  const hovered = useIsHovered(props.place.id);
  const setHovered = useSetHovered();

  return (
    <article
      id={cardId(props.place.id)}
      className={styles.card}
      data-active={hovered || undefined}
      onMouseEnter={() => setHovered(props.place.id)}
      onMouseLeave={() => setHovered(null)}
    >
      <PlaceImage name={props.place.name} logoUrl={props.place.logoUrl} logoBgColor={props.place.logoBgColor} />

      <div className={styles.body}>

        {/* El ::after del link cubre la card; el corazón y guardar quedan arriba (z-index) y no navegan. */}
        <h3 className={styles.name}>
          <Link href={`/place/${props.place.slug}`} className={styles.link}>{props.place.name}</Link>
        </h3>

        <p className={styles.meta}>
          {[
            props.place.neighborhood,
            ...props.place.categories.map((id) => label(id, "es")),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <p className={styles.openStatus}>
          {props.place.openStatus.prefix}
          <span className={styles.openTone} data-tone={props.place.openStatus.tone}>{props.place.openStatus.status}</span>
          {props.place.openStatus.detail && ` · ${props.place.openStatus.detail}`}
        </p>

        <CardDiscounts providers={props.place.discounts} />
        
        {/* {props.place.reasons.length > 0 && (
          <ul className={styles.reasons}>
            {props.place.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )} */}
        {props.debug && <p className={styles.debug}>{debugLine(props.debug)}</p>}
      </div>

      {/* Fuera del flujo: que aparezcan con el hover no reacomoda el texto ni los chips. */}
      <div className={styles.actions}>
        <LikeButton placeId={props.place.id} name={props.place.name} />
        <SaveButton placeId={props.place.id} name={props.place.name} />
      </div>
    </article>
  );
};

// Memoizada: con "Ver más" la grilla se re-renderiza, pero las cards que ya estaban reciben el mismo `place` (y `debug`).
export default memo(PlaceCard);
