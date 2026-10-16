"use client";

import PlaceCard, { type CardDebug } from "@/components/PlaceCard/PlaceCard";
import type { SearchResult } from "@/server/search";
import { cardId, useHoveredPlace } from "../Map/MapSync/MapSync";
import styles from "./ResultCard.module.scss";

type Props = {
  place: SearchResult;
  debug?: CardDebug;
};

/** PlaceCard con el hover sincronizado con su marcador. */
const ResultCard = (props: Props) => {
  const { hoveredId, setHoveredId } = useHoveredPlace();

  return (
    <div
      id={cardId(props.place.id)}
      className={styles.card}
      data-active={hoveredId === props.place.id || undefined}
      onMouseEnter={() => setHoveredId(props.place.id)}
      onMouseLeave={() => setHoveredId(null)}
    >
      <PlaceCard place={props.place} debug={props.debug} />
    </div>
  );
};

export default ResultCard;
