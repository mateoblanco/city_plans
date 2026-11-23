import Link from "next/link";
import type { GuideLink } from "@/server/guides/entries";
import PlaceSection from "../PlaceSection/PlaceSection";
import styles from "./PlaceGuides.module.scss";

type Props = {
  /** Las guías publicadas que incluyen el lugar (getPlaceGuides, cacheado); vacío: la sección no se muestra. */
  guides: GuideLink[];
};

/** "Aparece en estas guías": un link con el título de cada guía. Sólo datos de la base. */
const PlaceGuides = (props: Props) => {
  if (props.guides.length === 0) return null;
  return (
    <PlaceSection title="Aparece en estas guías">
      <ul className={styles.list}>
        {props.guides.map((guide) => (
          <li key={guide.slug}>
            <Link href={guide.href} className={styles.link}>
              {guide.title}
            </Link>
          </li>
        ))}
      </ul>
    </PlaceSection>
  );
};

export default PlaceGuides;
