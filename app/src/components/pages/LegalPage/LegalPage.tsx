import type { ReactNode } from "react";
import Header from "@/components/Header/Header";
import Footer from "@/components/Footer/Footer";
import SkipLinks from "@/components/SkipLinks/SkipLinks";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import { guideDate } from "@/components/pages/GuidePage/utils/dates";
import { LEGAL_PAGES, type LegalPageKey } from "@/lib/legal";
import { PRIVACY_SECTIONS } from "./content/privacy";
import { TERMS_SECTIONS } from "./content/terms";
import styles from "./LegalPage.module.scss";

export type LegalSection = {
  /** Id del h2: el ancla (#id) del índice y del link de la sección. */
  id: string;
  title: string;
  content: ReactNode;
};

const SECTIONS: Record<LegalPageKey, LegalSection[]> = { privacy: PRIVACY_SECTIONS, terms: TERMS_SECTIONS };

type Props = {
  /** Cuál de las dos: título, fecha y ruta salen de LEGAL_PAGES (src/lib/legal.ts); el texto, de content/. */
  page: LegalPageKey;
};

/**
 * Privacidad y Términos (/privacy, /terms): título, fecha de actualización, índice con links a cada sección y las
 * secciones, cada una con su h2 y un link a su ancla (visible al pasar o con foco).
 */
const LegalPage = (props: Props) => {
  const page = LEGAL_PAGES[props.page];
  const sections = SECTIONS[props.page];
  return (
    <>
      <SkipLinks links={[{ target: SKIP_TARGETS.content, label: "Ir al contenido" }]} />
      <Header />
      <main id={SKIP_TARGETS.content} data-skip-target className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>{page.title}</h1>
          <p className={styles.updated}>
            Última actualización: <time dateTime={page.updatedAt}>{guideDate(page.updatedAt)}</time>
          </p>
        </header>

        <nav className={styles.toc} aria-labelledby="legal-toc">
          <h2 id="legal-toc" className={styles.tocTitle}>En esta página</h2>
          <ol className={styles.tocList}>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className={styles.tocLink}>{section.title}</a>
              </li>
            ))}
          </ol>
        </nav>

        <div className={styles.content}>
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id} className={styles.section}>
              <h2 id={section.id} className={styles.heading}>
                {section.title}
                <a href={`#${section.id}`} className={styles.anchor} aria-label={`Enlace a la sección «${section.title}»`}>
                  #
                </a>
              </h2>
              {section.content}
            </section>
          ))}
        </div>
      </main>
      <Footer current={props.page} />
    </>
  );
};

export default LegalPage;
