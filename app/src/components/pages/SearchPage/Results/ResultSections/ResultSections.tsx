import Link from "next/link";
import Button from "@/components/base/Button/Button";
import ArrowRight from "@/assets/arrow_right.svg";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import PlacesGrid from "../PlacesGrid/PlacesGrid";
import StickyHeader from "./StickyHeader/StickyHeader";
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
 * con más lugares de los que muestra tiene "Ver todos" (el título y la flecha): la misma búsqueda con la regla del grupo
 * como filtro.
 */
const ResultSections = (props: Props) => (
  <div className={styles.sections}>
    {props.sections.map((section) => (
      <section key={section.id} className={styles.section}>
        <StickyHeader className={styles.header}>
          <h2 className={styles.title}>
            {hasViewAll(section) ? (
              <Link className={styles.titleLink} href={sectionHref(props.state, section.id)} prefetch={false}>
                {section.title}
              </Link>
            ) : (
              section.title
            )}
          </h2>
          {hasViewAll(section) && (
            <Button
              href={sectionHref(props.state, section.id)}
              prefetch={false}
              variant="tertiary"
              size="sm"
              onlyIcon
              label={`Ver todos: ${section.title}`}
              icon={<ArrowRight aria-hidden width={12} height={12} />}
            />
          )}
        </StickyHeader>
        <PlacesGrid places={section.places} scores={props.scores} />
      </section>
    ))}
  </div>
);

export default ResultSections;
