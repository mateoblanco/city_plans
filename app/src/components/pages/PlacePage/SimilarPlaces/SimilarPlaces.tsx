import type { SearchResult } from "@/server/search";
import PlaceSection from "../PlaceSection/PlaceSection";
import PlaceCardMini from "./PlaceCardMini/PlaceCardMini";
import styles from "./SimilarPlaces.module.scss";

type Props = {
  name: string;
  places: SearchResult[];
};

/** "Parecidos a <lugar>" con cards mini, en dos columnas. Sin ninguno, no se muestra. */
const SimilarPlaces = (props: Props) => {
  if (props.places.length === 0) return null;

  return (
    <PlaceSection title={`Lugares similares`}>
      <div className={styles.grid}>
        {props.places.map((place) => (
          <PlaceCardMini key={place.id} place={place} />
        ))}
      </div>
    </PlaceSection>
  );
};

export default SimilarPlaces;
