import type { SearchResult } from "@/server/search";
import PlaceCard from "../PlaceCard/PlaceCard";
import styles from "./SelectedPlace.module.scss";

type Props = {
  place: SearchResult;
};

/**
 * Mobile: la card del marcador tocado, flotando sobre el mapa arriba del panel (que baja a la altura baja). Es la
 * PlaceCard de siempre: tocarla lleva a la ficha.
 */
const SelectedPlace = (props: Props) => (
  <div className={styles.selected}>
    <PlaceCard place={props.place} />
  </div>
);

export default SelectedPlace;
