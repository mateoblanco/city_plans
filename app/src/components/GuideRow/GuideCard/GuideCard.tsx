import Image from "next/image";
import Link from "next/link";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import { placesCount, type GuideCardData } from "@/server/guides/neighborhood";
import styles from "./GuideCard.module.scss";

type Props = {
  guide: GuideCardData;
};

/**
 * Tarjeta de una guía (páginas de barrio y de ciudad): los logos de sus primeros 3 lugares encimados (decorativos), el título y
 * la cantidad de lugares. Toda la tarjeta es el link (el ::after del título), con nombre "Título, 9 lugares". Si la
 * guía tiene portada, va arriba (hoy ninguna tiene).
 */
const GuideCard = (props: Props) => {
  const guide = props.guide;
  const count = placesCount(guide.count);
  return (
    <article className={styles.card}>
      {guide.cover && (
        <Image
          className={styles.cover}
          src={guide.cover.src}
          alt=""
          width={guide.cover.width}
          height={guide.cover.height}
          sizes="(min-width: 768px) 320px, 72vw"
        />
      )}
      <span className={styles.logos} aria-hidden>
        {guide.logos.map((logo) => (
          <span key={logo.id} className={styles.logo}>
            <PlaceImage name={logo.name} logoUrl={logo.logoUrl} logoBgColor={logo.logoBgColor} size="sm" decorative />
          </span>
        ))}
      </span>
      <h3 className={styles.title}>
        <Link href={guide.href} className={styles.link} aria-label={`${guide.title}, ${count}`}>
          {guide.title}
        </Link>
      </h3>
      <p className={styles.count} aria-hidden>
        {count}
      </p>
    </article>
  );
};

export default GuideCard;
