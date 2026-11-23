import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import ArrowRight from "@/assets/arrow_right.svg";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import type { GuideCardData } from "@/server/guides/neighborhood";
import styles from "./GuideCard.module.scss";

type Props = {
  guide: GuideCardData;
};

/**
 * Tarjeta de una guía (páginas de barrio y de ciudad): arriba, de borde a borde, una franja del color de la guía (elegido
 * en el backoffice) con los logos de sus primeros 3 lugares encimados (decorativos); debajo, el título y el barrio (si
 * tiene), con la flecha abajo a la derecha (decorativa). Toda la tarjeta es el link (el ::after del título), con nombre "Título, Pocitos".
 * Si la guía tiene portada, va arriba (hoy ninguna tiene).
 */
const GuideCard = (props: Props) => {
  const guide = props.guide;
  // El color es un dato de la base (como el fondo del logo en PlaceImage): va por variable CSS.
  const band = { "--guide-color": guide.color } as CSSProperties;
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
      <span className={styles.band} style={band} aria-hidden>
        {guide.logos.map((logo) => (
          <span key={logo.id} className={styles.logo}>
            <PlaceImage name={logo.name} logoUrl={logo.logoUrl} logoBgColor={logo.logoBgColor} size="sm" decorative withoutBorder />
          </span>
        ))}
      </span>
      <div className={styles.body}>
        <div className={styles.text}>
          <h3 className={styles.title}>
            <Link href={guide.href} className={styles.link} aria-label={guide.neighborhood ? `${guide.title}, ${guide.neighborhood}` : undefined}>
              {guide.title}
            </Link>
          </h3>
          {guide.neighborhood && (
            <p className={styles.count} aria-hidden>
              {guide.neighborhood}
            </p>
          )}
        </div>
        <ArrowRight className={styles.arrow} aria-hidden width={16} height={14} />
      </div>
    </article>
  );
};

export default GuideCard;
