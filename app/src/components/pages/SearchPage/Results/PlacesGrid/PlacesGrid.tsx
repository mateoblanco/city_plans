import type { SearchResult } from "@/server/search";
import PlaceCard, { type CardDebug } from "../PlaceCard/PlaceCard";
import styles from "./PlacesGrid.module.scss";

type Props = {
  places: SearchResult[];
  scores: Map<string, CardDebug> | null;
  /** 1: una card por fila (Lugares similares en la ficha); sin columns, dos. */
  columns?: 1;
};

const PlacesGrid = (props: Props) => (
  <div className={styles.grid} data-columns={props.columns}>
    {props.places.map((place) => (
      <PlaceCard key={place.id} place={place} debug={props.scores?.get(place.id)} />
    ))}
  </div>
);

export default PlacesGrid;
