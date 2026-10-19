"use client";

import { label } from "@shared/tags.ts";
import type { SearchResult } from "@/server/search";
import type { KeptBy } from "@/server/search/relevance";
import PlaceImage from "./PlaceImage/PlaceImage";
import { cardId, useHoveredPlace } from "../Map/MapSync/MapSync";
import styles from "./PlaceCard.module.scss";

/** Sólo con ?debug=1: puntajes, similitud semántica con la consulta y por qué pasó el corte por relevancia. */
export type CardDebug = { score: number; baseScore: number; multiplier: number; similarity: number | null; keptBy: KeptBy | null; pinned: boolean };

const KEPT_LABELS: Record<KeptBy, string> = {
  pinned: "por nombre",
  category: "por categoría",
  tag: "por tag",
  dish: "por plato",
  keyword: "por keyword",
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
  const { hoveredId, setHoveredId } = useHoveredPlace();
  // Los motivos ya incluyen el barrio y el horario, que acá tienen su propia línea.
  const reasons = props.place.reasons.filter((reason) => reason !== props.place.neighborhood && reason !== props.place.openStatus.label);

  return (
    <article
      id={cardId(props.place.id)}
      className={styles.card}
      data-active={hoveredId === props.place.id || undefined}
      onMouseEnter={() => setHoveredId(props.place.id)}
      onMouseLeave={() => setHoveredId(null)}
    >
      <PlaceImage name={props.place.name} logoUrl={props.place.logoUrl} logoBgColor={props.place.logoBgColor} />

      <div className={styles.body}>

        <h3 className={styles.name}>{props.place.name}</h3>

        <p className={styles.meta}>
          {[props.place.neighborhood, ...props.place.categories.map((id) => label(id, "es"))].join(" · ")}
        </p>

        <p className={styles.openStatus}>
          {props.place.openStatus.prefix}
          <span className={styles.openTone} data-tone={props.place.openStatus.tone}>{props.place.openStatus.status}</span>
          {props.place.openStatus.detail && ` · ${props.place.openStatus.detail}`}
        </p>
        
        {/* {reasons.length > 0 && (
          <ul className={styles.reasons}>
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )} */}
        {props.debug && <p className={styles.debug}>{debugLine(props.debug)}</p>}
      </div>
    </article>
  );
};

export default PlaceCard;
