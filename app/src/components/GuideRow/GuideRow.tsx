import Image, { type StaticImageData } from "next/image";
import RowScroller from "@/components/pages/HomePage/HomeSections/RowScroller/RowScroller";
import type { GuideCardData } from "@/server/guides/neighborhood";
import GuideCard from "./GuideCard/GuideCard";
import styles from "./GuideRow.module.scss";

type Props = {
  /** El grupo (eat, bars…): el id del título. */
  id: string;
  /** "Cafés". */
  title: string;
  /** El ícono del mapa del grupo (TAB_ICONS), al lado del título; sin él, sólo el título ("Más guías"). */
  icon?: StaticImageData;
  guides: GuideCardData[];
};

/**
 * Una fila de las páginas de barrio y de ciudad: una sección con su título y las tarjetas de sus guías. En mobile, scroll horizontal
 * con el degradado de las filas de la home (RowScroller, el mismo comportamiento); desde md, grilla sin scroll.
 */
const GuideRow = (props: Props) => {
  const titleId = `guides-${props.id}`;
  return (
    <section className={styles.row} aria-labelledby={titleId}>
      <h2 className={styles.title} id={titleId}>
        {props.icon && <Image className={styles.icon} src={props.icon} alt="" width={24} height={24} />}
        {props.title}
      </h2>
      <RowScroller className={styles.scroller}>
        {props.guides.map((guide) => (
          <li key={guide.slug} className={styles.item}>
            <GuideCard guide={guide} />
          </li>
        ))}
      </RowScroller>
    </section>
  );
};

export default GuideRow;
