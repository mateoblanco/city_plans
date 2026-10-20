import type { SearchResponse, SearchResult } from "@/server/search";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import PlacesGrid from "../PlacesGrid/PlacesGrid";
import styles from "./ResultSections.module.scss";

type Props = {
  sections: NonNullable<SearchResponse["sections"]>;
  results: SearchResult[];
  scores: Map<string, CardDebug> | null;
};

/** Búsqueda amplia: los resultados en secciones con título, una debajo de la otra y cada lugar una sola vez. */
const ResultSections = (props: Props) => {
  const byId = new Map(props.results.map((place) => [place.id, place]));
  return (
    <div className={styles.sections}>
      {props.sections.map((section) => (
        <section key={section.id} className={styles.section}>
          <h2 className={styles.title}>{section.title}</h2>
          <PlacesGrid places={section.placeIds.flatMap((id) => byId.get(id) ?? [])} scores={props.scores} />
        </section>
      ))}
    </div>
  );
};

export default ResultSections;
