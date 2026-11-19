import Link from "next/link";
import styles from "./GuideBreadcrumb.module.scss";

export type BreadcrumbItem = {
  label: string;
  /** Sin href, texto (Guías y Montevideo todavía no tienen página). */
  href?: string;
  /** La página actual (aria-current): el barrio en su propia página. */
  current?: boolean;
};

type Props = {
  items: BreadcrumbItem[];
};

/** Migas de las guías (Guías / Montevideo / Cordón): la de la guía y la del barrio. Separadores decorativos. */
const GuideBreadcrumb = (props: Props) => (
  <nav aria-label="Migas de pan">
    <ol className={styles.list}>
      {props.items.map((item, index) => (
        <li key={item.label} className={styles.item} aria-current={item.current ? "page" : undefined}>
          {index > 0 && (
            <span className={styles.separator} aria-hidden>
              /
            </span>
          )}
          {item.href && !item.current ? (
            <Link href={item.href} className={styles.link}>
              {item.label}
            </Link>
          ) : (
            item.label
          )}
        </li>
      ))}
    </ol>
  </nav>
);

export default GuideBreadcrumb;
