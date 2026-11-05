import Link from "next/link";
import Button from "@/components/base/Button/Button";
import ArrowRight from "@/assets/arrow_right.svg";
import type { SearchResult } from "@/server/search";
import PlaceCard from "@/components/pages/SearchPage/Results/PlaceCard/PlaceCard";
import RowScroller from "./RowScroller/RowScroller";
import styles from "./PlaceRow.module.scss";

type Props = {
  title: string;
  places: SearchResult[];
  /** "Ver todos": la misma búsqueda en /search. null: sin link ("Para vos"). */
  href: string | null;
};

/** Una fila de la home: título y cards con scroll horizontal (con degradado a la derecha mientras haya más). */
const PlaceRow = (props: Props) => (
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
          label={`Ver todos: ${props.title}`}
          icon={<ArrowRight aria-hidden width={12} height={12} />}
        />
      )}
    </header>
    <RowScroller className={styles.scroller}>
      {props.places.map((place) => (
        <li key={place.id} className={styles.item}>
          <PlaceCard place={place} />
        </li>
      ))}
    </RowScroller>
  </section>
);

export default PlaceRow;
