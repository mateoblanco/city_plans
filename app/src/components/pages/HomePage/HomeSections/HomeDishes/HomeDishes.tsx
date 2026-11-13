import { eagerImage } from "@/components/pages/SearchPage/utils/eager-images";
import RowScroller from "../RowScroller/RowScroller";
import DishCard from "./DishCard/DishCard";
import { DISHES, EAGER_DISHES } from "./utils/dishes";
import styles from "./HomeDishes.module.scss";

const TITLE = "Platos";

type Props = {
  /** La fila se ve al cargar (va primera en la home): las primeras fotos van eager. */
  eager?: boolean;
};

/** Fila de platos de la home: foto y nombre; cada uno lleva a /search con su nombre. */
const HomeDishes = (props: Props) => (
  <section className={styles.row} aria-label={TITLE}>
    <h2 className={styles.title}>{TITLE}</h2>
    <RowScroller className={styles.scroller}>
      {DISHES.map((dish, index) => (
        <li key={dish.text}>
          <DishCard href={dish.href} text={dish.text} image={dish.image} load={eagerImage(index, props.eager ? EAGER_DISHES : undefined)} />
        </li>
      ))}
    </RowScroller>
  </section>
);

export default HomeDishes;
