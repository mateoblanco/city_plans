import Link from "next/link";
import Button from "@/components/base/Button/Button";
import ArrowRight from "@/assets/arrow_right.svg";
import type { SearchResult } from "@/server/search";
import type { RowLogo } from "@/server/home/assemble";
import PlaceCard from "@/components/pages/SearchPage/Results/PlaceCard/PlaceCard";
import { eagerImage } from "@/components/pages/SearchPage/utils/eager-images";
import RowScroller from "../RowScroller/RowScroller";
import ViewAllCard from "./ViewAllCard/ViewAllCard";
import { viewAllCard, viewAllLabel } from "./utils/view-all";
import styles from "./PlaceRow.module.scss";

type Props = {
  /** Id de la fila (popularidad: de qué fila vino el click). "saved" es Guardados. */
  id: string;
  title: string;
  places: SearchResult[];
  /** "Ver todos": la misma búsqueda en /search. null: sin link ("Para vos"). */
  href: string | null;
  /** Logos de los que siguen en el pool (assembleHome): con href y alguno, la card "Ver todos" al final. */
  more?: RowLogo[];
  /** Cuántas cards del principio llevan el logo eager; sin eagerCount, ninguna. */
  eagerCount?: number;
};

/** Una fila de la home: título y cards con scroll horizontal (con degradado a la derecha mientras haya más). */
const PlaceRow = (props: Props) => {
  const viewAll = viewAllCard(props);

  return (
    <section className={styles.row} aria-label={props.title}>
      <header className={styles.header}>
        <h2 className={styles.title}>
          {props.href ? (
            <Link className={styles.titleLink} href={props.href} prefetch={false}>
              {props.title}
            </Link>
          ) : (
            props.title
          )}
        </h2>
        {props.href && (
          <Button
            href={props.href}
            prefetch={false}
            variant="tertiary"
            size="sm"
            onlyIcon
            label={viewAllLabel(props.title)}
            icon={<ArrowRight aria-hidden width={12} height={12} />}
          />
        )}
      </header>
      <RowScroller className={styles.scroller}>
        {props.places.map((place, index) => (
          <li key={place.id} className={styles.item}>
            <PlaceCard
              place={place}
              eagerImage={eagerImage(index, props.eagerCount)}
              origin={props.id === "saved" ? "saved" : "home"}
              originRow={props.id}
            />
          </li>
        ))}
        {viewAll && (
          <li className={styles.item}>
            <ViewAllCard href={viewAll.href} label={viewAll.label} logos={viewAll.logos} />
          </li>
        )}
      </RowScroller>
    </section>
  );
};

export default PlaceRow;
