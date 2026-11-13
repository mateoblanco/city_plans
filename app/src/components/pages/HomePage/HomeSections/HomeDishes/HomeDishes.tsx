import FilterChip from "@/components/HeaderSearch/FilterBar/FilterChip/FilterChip";
import RowScroller from "../RowScroller/RowScroller";
import { DISHES } from "./utils/dishes";
import styles from "./HomeDishes.module.scss";

const TITLE = "Platos";

/** Fila de platos de la home: cada uno lleva a /search con su nombre. Simple por ahora (sólo texto). */
const HomeDishes = () => (
  <section className={styles.row} aria-label={TITLE}>
    <h2 className={styles.title}>{TITLE}</h2>
    <RowScroller className={styles.scroller}>
      {DISHES.map((dish) => (
        <li key={dish.text}>
          <FilterChip href={dish.href} text={dish.text} />
        </li>
      ))}
    </RowScroller>
  </section>
);

export default HomeDishes;
