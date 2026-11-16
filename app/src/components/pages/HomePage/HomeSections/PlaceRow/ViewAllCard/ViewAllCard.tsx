import Link from "next/link";
import type { RowLogo } from "@/server/home/assemble";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import styles from "./ViewAllCard.module.scss";

type Props = {
  href: string;
  /** Nombre accesible del link ("Ver todos: Para cenar"). */
  label: string;
  /** Los siguientes lugares del pool (hasta 3): sus logos encimados, decorativos. */
  logos: RowLogo[];
};

/**
 * Última card de una fila de la home, al "Ver todos" de la fila. Como en PlaceCard, el foco va a un link chico (el
 * texto) y su ::after cubre la card: toda la card es el link y, al llegar con Tab, el scroll de la fila la trae a la
 * vista (con la card entera como link, Chrome no scrollea si asoma un borde).
 */
const ViewAllCard = (props: Props) => (
  <div className={styles.card}>
    <span className={styles.logos} aria-hidden>
      {props.logos.map((logo) => (
        <span key={logo.id} className={styles.logo}>
          <PlaceImage name={logo.name} logoUrl={logo.logoUrl} logoBgColor={logo.logoBgColor} size="sm" decorative />
        </span>
      ))}
    </span>
    <Link href={props.href} prefetch={false} className={styles.link} aria-label={props.label}>
      Ver todos
    </Link>
  </div>
);

export default ViewAllCard;
