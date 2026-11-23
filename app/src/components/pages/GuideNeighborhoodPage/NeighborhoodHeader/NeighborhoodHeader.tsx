import GuideBreadcrumb, { type BreadcrumbItem } from "@/components/GuideBreadcrumb/GuideBreadcrumb";
import styles from "./NeighborhoodHeader.module.scss";

type Props = {
  /** Montevideo (link) / Cordón (actual). */
  breadcrumb: BreadcrumbItem[];
  /** "Cordón". */
  name: string;
  intro: string[];
};

/** Migas (Montevideo / Cordón), el barrio grande y la intro. */
const NeighborhoodHeader = (props: Props) => (
  <header className={styles.header}>
    <GuideBreadcrumb items={props.breadcrumb} />
    <h1 className={styles.title}>{props.name}</h1>
    {props.intro.length > 0 && (
      <div className={styles.intro}>
        {props.intro.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    )}
  </header>
);

export default NeighborhoodHeader;
