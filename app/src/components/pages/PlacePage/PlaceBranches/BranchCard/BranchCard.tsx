import Link from "next/link";
import styles from "./BranchCard.module.scss";

type Props = {
  slug: string;
  neighborhood: string;
  /** De Google, del pedido; null si no vino. */
  address: string | null;
};

/** Otra sucursal: "Sucursal Cordón" y su dirección; toda la card lleva a su ficha. */
const BranchCard = (props: Props) => (
  <article className={styles.card}>
    <h3 className={styles.title}>
      <Link href={`/place/${props.slug}`} className={styles.link}>Sucursal {props.neighborhood}</Link>
    </h3>
    {props.address && <p className={styles.address}>{props.address}</p>}
  </article>
);

export default BranchCard;
