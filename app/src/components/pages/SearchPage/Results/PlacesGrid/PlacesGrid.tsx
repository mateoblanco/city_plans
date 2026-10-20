import type { SearchResult } from "@/server/search";
import PlaceCard, { type CardDebug } from "../PlaceCard/PlaceCard";
import styles from "./PlacesGrid.module.scss";

type Props = {
  places: SearchResult[];
  scores: Map<string, CardDebug> | null;
};

const PlacesGrid = (props: Props) => (
  <div className={styles.grid}>
    {props.places.map((place) => (
      <PlaceCard key={place.id} place={place} debug={props.scores?.get(place.id)} />
    ))}
  </div>
);

export default PlacesGrid;
