import type { SearchResult } from "@/server/search";
import PlaceCard, { type CardDebug } from "../PlaceCard/PlaceCard";
import { eagerImage } from "../../utils/eager-images";
import styles from "./PlacesGrid.module.scss";

type Props = {
  places: SearchResult[];
  scores: Map<string, CardDebug> | null;
  /** 1: una card por fila (Lugares similares en la ficha); sin columns, dos. */
  columns?: 1;
  /** Cuántas cards del principio llevan el logo eager; sin eagerCount, ninguna. */
  eagerCount?: number;
};

const PlacesGrid = (props: Props) => (
  <div className={styles.grid} data-columns={props.columns}>
    {props.places.map((place, index) => (
      <PlaceCard key={place.id} place={place} debug={props.scores?.get(place.id)} eagerImage={eagerImage(index, props.eagerCount)} />
    ))}
  </div>
);

export default PlacesGrid;
