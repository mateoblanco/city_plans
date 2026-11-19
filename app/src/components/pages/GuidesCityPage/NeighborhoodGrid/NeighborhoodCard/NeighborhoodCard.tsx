import Link from "next/link";
import styles from "./NeighborhoodCard.module.scss";

type Props = {
  /** "Cordón". */
  name: string;
  /** /guides/montevideo/cordon. */
  href: string;
};

/** Tarjeta de un barrio en la página de la ciudad: sólo el nombre; toda la tarjeta es el link a sus guías. */
const NeighborhoodCard = (props: Props) => (
  <Link href={props.href} className={styles.card}>
    <span className={styles.name}>{props.name}</span>
    <span className={styles.arrow} aria-hidden>
      →
    </span>
  </Link>
);

export default NeighborhoodCard;
