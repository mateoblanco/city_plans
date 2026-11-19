import GuideBreadcrumb, { type BreadcrumbItem } from "@/components/GuideBreadcrumb/GuideBreadcrumb";
import { guideDate } from "../utils/dates";
import styles from "./GuideHeader.module.scss";

type Props = {
  /** Guías de Montevideo / Cordón / título (la guía, actual); sin barrio en una guía de ciudad. */
  breadcrumb: BreadcrumbItem[];
  /** "Cafés". */
  group: string;
  title: string;
  /** YYYY-MM-DD. */
  updatedAt: string;
  intro: string[];
};

/**
 * Migas (Guías de Montevideo / Cordón / la guía), el grupo, el título, la fecha de actualización y la introducción.
 */
const GuideHeader = (props: Props) => (
  <header className={styles.header}>
    <GuideBreadcrumb items={props.breadcrumb} />
    <p className={styles.group}>{props.group}</p>
    <h1 className={styles.title}>{props.title}</h1>
    <p className={styles.updated}>
      Actualizada el <time dateTime={props.updatedAt}>{guideDate(props.updatedAt)}</time>
    </p>
    <div className={styles.intro}>
      {props.intro.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </div>
  </header>
);

export default GuideHeader;
