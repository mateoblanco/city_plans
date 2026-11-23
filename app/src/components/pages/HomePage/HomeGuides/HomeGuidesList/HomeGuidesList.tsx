import Link from "next/link";
import ArrowRight from "@/assets/arrow_right.svg";
import Button from "@/components/base/Button/Button";
import type { GuideLink } from "@/server/guides/entries";
import { cityPath } from "@/server/guides/catalog";
import styles from "./HomeGuidesList.module.scss";

type Props = {
  guides: GuideLink[];
};

const ALL_GUIDES = cityPath("montevideo");

/**
 * "Guías": el título lleva a todas las guías, con el botón de la flecha como en las filas de la home (PlaceRow), y
 * debajo un link de texto por guía (el título y, si tiene, el barrio en chico), sin logos ni tarjetas; una columna en
 * mobile y dos desde md. Sin guías, nada.
 */
const HomeGuidesList = (props: Props) => {
  if (props.guides.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="home-guides">
      <header className={styles.header}>
        <h2 className={styles.title} id="home-guides">
          <Link className={styles.titleLink} href={ALL_GUIDES}>
            Guías
          </Link>
        </h2>
        <Button href={ALL_GUIDES} variant="tertiary" size="sm" onlyIcon label="Ver todas las guías" icon={<ArrowRight aria-hidden width={12} height={12} />} touchTarget />
      </header>
      <ul className={styles.list}>
        {props.guides.map((guide) => (
          <li key={guide.slug}>
            <Link href={guide.href} className={styles.link}>
              <span className={styles.name}>{guide.title}</span>
              {guide.neighborhood && <span className={styles.meta}>{guide.neighborhood}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default HomeGuidesList;
