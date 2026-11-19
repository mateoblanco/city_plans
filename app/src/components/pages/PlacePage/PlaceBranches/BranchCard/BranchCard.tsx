import OriginLink from "@/components/Tracking/OriginLink/OriginLink";
import styles from "./BranchCard.module.scss";

type Props = {
  slug: string;
  neighborhood: string;
};

/** Otra sucursal: "Sucursal Cordón" (sin dirección: es de Google); toda la card lleva a su ficha. */
const BranchCard = (props: Props) => (
  <article className={styles.card}>
    <h3 className={styles.title}>
      <OriginLink slug={props.slug} origin="branch" className={styles.link}>Sucursal {props.neighborhood}</OriginLink>
    </h3>
  </article>
);

export default BranchCard;
