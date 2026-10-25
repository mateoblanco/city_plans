import Image from "next/image";
import type { CSSProperties } from "react";
import styles from "./PlaceImage.module.scss";

type Props = {
  name: string;
  logoUrl: string | null;
  logoBgColor: string | null;
};

/** Banner de la card: el logo centrado sobre su color de fondo; sin logo, el nombre. */
const PlaceImage = (props: Props) => {

  const background = props.logoBgColor ? ({ "--banner-bg": props.logoBgColor } as CSSProperties) : undefined;

  return (
    <div className={styles.image} style={background}>
      {props.logoUrl && <Image
        src={props.logoUrl}
        alt={`Logo de ${props.name}`}
        width={60}
        height={66}
        unoptimized
        className={styles.logo} />
      }
      {!props.logoUrl && <span className={styles.name}>{props.name}</span>}
    </div>
  );
};

export default PlaceImage;
