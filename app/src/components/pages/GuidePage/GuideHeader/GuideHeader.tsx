import GuideBreadcrumb, { type BreadcrumbItem } from "@/components/GuideBreadcrumb/GuideBreadcrumb";
import { guideDate } from "../utils/dates";
import styles from "./GuideHeader.module.scss";

type Props = {
  /** Montevideo / título (la guía, actual); con el barrio en el medio si su página está activa. La guía no se muestra
   * (ya es el h1): sólo las migas hacia arriba. El BreadcrumbList del JSON-LD sí la lleva. */
  breadcrumb: BreadcrumbItem[];
  /** El barrio de la guía como etiqueta ("Pocitos"); null en una guía de toda la ciudad (sin etiqueta). */
  neighborhood: string | null;
  title: string;
  /** YYYY-MM-DD. */
  updatedAt: string;
  intro: string[];
};

/**
 * Migas, el barrio (etiqueta), el título, la fecha de actualización y la introducción.
 */
const GuideHeader = (props: Props) => (
  <header className={styles.header}>
    <GuideBreadcrumb items={props.breadcrumb.filter((crumb) => !crumb.current)} />
    {props.neighborhood && (
      <ul className={styles.tags} aria-label="Etiquetas de la guía">
        <li className={styles.tag}>{props.neighborhood}</li>
      </ul>
    )}
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
