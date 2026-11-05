import type { SearchResult } from "@/server/search";
import PlacesGrid from "@/components/pages/SearchPage/Results/PlacesGrid/PlacesGrid";
import PlaceSection from "../PlaceSection/PlaceSection";

type Props = {
  name: string;
  places: SearchResult[];
};

/** "Parecidos a <lugar>" con las cards de la búsqueda. Sin ninguno, no se muestra. */
const SimilarPlaces = (props: Props) => {
  if (props.places.length === 0) return null;

  return (
    <PlaceSection title={`Lugares similares`}>
      <PlacesGrid places={props.places} scores={null} />
    </PlaceSection>
  );
};

export default SimilarPlaces;
