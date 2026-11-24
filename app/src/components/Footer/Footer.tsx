import Link from "next/link";
import Logo from "@/assets/logo.svg";
import { LEGAL_PAGES, type LegalPageKey } from "@/lib/legal";
import { COPYRIGHT_YEAR, SITE_NAME } from "@/lib/site";
import styles from "./Footer.module.scss";

type Props = {
  /** En /privacy o /terms: el link a esa misma página va con aria-current="page" y se ve como texto (LegalPage). */
  current?: LegalPageKey;
};

const LINKS: LegalPageKey[] = ["privacy", "terms"];

/** Pie de la home, las guías, la ficha y las páginas legales (no de /search): logo con el © debajo y los links legales. */
const Footer = (props: Props) => {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.start}>
          {/* El nombre visible es el nombre del link (sin aria-label: tiene que contener el texto que se ve). */}
          <Link href="/" className={styles.brand}>
            <Logo width={32} height={32} aria-hidden />
            <span>{SITE_NAME}</span>
          </Link>
          <p className={styles.copyright}>© {COPYRIGHT_YEAR} {SITE_NAME}</p>
        </div>
        <nav aria-label="Legal">
          <ul className={styles.links}>
            {LINKS.map((key) => (
              <li key={key}>
                <Link href={LEGAL_PAGES[key].path} className={styles.link} aria-current={props.current === key ? "page" : undefined}>
                  {LEGAL_PAGES[key].title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
};

export default Footer;
