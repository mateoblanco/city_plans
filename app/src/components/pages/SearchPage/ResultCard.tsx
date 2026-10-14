"use client";

import PlaceCard from "@/components/PlaceCard/PlaceCard";
import type { SearchResult } from "@/server/search";
import { cardId, useHoveredPlace } from "./MapSync";
import styles from "./SearchPage.module.scss";

/** PlaceCard con el hover sincronizado con su marcador. */
const ResultCard = ({ place }: { place: SearchResult }) => {
  const { hoveredId, setHoveredId } = useHoveredPlace();

  return (
    <div
      id={cardId(place.id)}
      className={styles.card}
      data-active={hoveredId === place.id || undefined}
      onMouseEnter={() => setHoveredId(place.id)}
      onMouseLeave={() => setHoveredId(null)}
    >
      <PlaceCard place={place} />
    </div>
  );
};

export default ResultCard;
