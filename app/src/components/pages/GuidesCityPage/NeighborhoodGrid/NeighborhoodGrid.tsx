import type { CityNeighborhood } from "@/server/guides/city";
import NeighborhoodCard from "./NeighborhoodCard/NeighborhoodCard";
import styles from "./NeighborhoodGrid.module.scss";

type Props = {
  neighborhoods: CityNeighborhood[];
};

/** Sección "Barrios": una tarjeta por barrio con guías, en orden alfabético (ya viene ordenado). */
const NeighborhoodGrid = (props: Props) => (
  <section className={styles.section} aria-labelledby="guides-neighborhoods">
    <h2 className={styles.title} id="guides-neighborhoods">
      Barrios
    </h2>
    <ul className={styles.grid}>
      {props.neighborhoods.map((neighborhood) => (
        <li key={neighborhood.id}>
          <NeighborhoodCard name={neighborhood.name} href={neighborhood.href} />
        </li>
      ))}
    </ul>
  </section>
);

export default NeighborhoodGrid;
