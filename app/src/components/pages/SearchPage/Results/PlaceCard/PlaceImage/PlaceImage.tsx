import Image from "next/image";
import type { CSSProperties } from "react";
import styles from "./PlaceImage.module.scss";

type Props = {
  name: string;
  logoUrl: string | null;
  logoBgColor: string | null;
  /** lg: el logo grande de la ficha del lugar; sin size, el de la card. */
  size?: "lg";
  /** Ficha sobre una barra blanca o casi blanca: el borde del logo pasa a ser el de borde, no el de superficie. */
  onLightBar?: boolean;
};

/** Banner de la card (y logo de la ficha): el logo centrado sobre su color de fondo; sin logo, el nombre. */
const PlaceImage = (props: Props) => {

  const background = props.logoBgColor ? ({ "--banner-bg": props.logoBgColor } as CSSProperties) : undefined;

  return (
    <div className={props.onLightBar ? `${styles.image} ${styles.onLightBar}` : styles.image} style={background} data-size={props.size}>
      {props.logoUrl && <Image
        src={props.logoUrl}
        alt={`Logo de ${props.name}`}
        width={props.size === "lg" ? 120 : 60}
        height={props.size === "lg" ? 120 : 66}
        unoptimized
        className={styles.logo} />
      }
      {!props.logoUrl && <span className={styles.name}>{props.name}</span>}
    </div>
  );
};

export default PlaceImage;
