import type { SearchResult } from "@/server/search";
import PlaceSection from "../PlaceSection/PlaceSection";
import PlaceCardMini from "./PlaceCardMini/PlaceCardMini";
import styles from "./SimilarPlaces.module.scss";

type Props = {
  name: string;
  /** Llega después de lo de la base (PlacePage lo pone en su propio Suspense). */
  places: Promise<SearchResult[]>;
};

/** "Parecidos a <lugar>" con cards mini, en dos columnas. Sin ninguno, no se muestra. */
const SimilarPlaces = async (props: Props) => {
  const places = await props.places;
  if (places.length === 0) return null;

  return (
    <PlaceSection title={`Lugares similares`}>
      <div className={styles.grid}>
        {places.map((place) => (
          <PlaceCardMini key={place.id} place={place} />
        ))}
      </div>
    </PlaceSection>
  );
};

export default SimilarPlaces;
