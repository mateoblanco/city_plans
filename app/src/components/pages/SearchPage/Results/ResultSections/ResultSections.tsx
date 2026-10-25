import Link from "next/link";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import PlacesGrid from "../PlacesGrid/PlacesGrid";
import styles from "./ResultSections.module.scss";
import { hasViewAll, type VisibleSection } from "../../utils/pagination";
import { sectionHref, type SearchUrl } from "../../utils/search-href";

type Props = {
  sections: VisibleSection[];
  scores: Map<string, CardDebug> | null;
  state: SearchUrl;
};

/**
 * Búsqueda amplia: los resultados en secciones con título, una debajo de la otra y cada lugar una sola vez. Un grupo
 * con más lugares de los que muestra tiene "Ver todos": la misma búsqueda con la regla del grupo como filtro.
 */
const ResultSections = (props: Props) => (
  <div className={styles.sections}>
    {props.sections.map((section) => (
      <section key={section.id} className={styles.section}>
        <div className={styles.header}>
          <h2 className={styles.title}>{section.title}</h2>
          {hasViewAll(section) && (
            <Link className={styles.viewAll} href={sectionHref(props.state, section.id)} prefetch={false}>
              Ver todos
            </Link>
          )}
        </div>
        <PlacesGrid places={section.places} scores={props.scores} />
      </section>
    ))}
  </div>
);

export default ResultSections;
