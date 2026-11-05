import type { CSSProperties } from "react";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import BackButton from "./BackButton/BackButton";
import PlaceActions from "./PlaceActions/PlaceActions";
import { instagramHandle, instagramPopularHref, toneOn } from "../utils/summary";
import styles from "./PlaceHeader.module.scss";

type Props = {
  placeId: string;
  name: string;
  logoUrl: string | null;
  logoBgColor: string | null;
  instagram: string | null;
};

/**
 * Encabezado de la ficha: con logo, una barra del color del logo y el logo encima; sin logo, sin barra y lo mismo que
 * muestra la card (el nombre). "← Volver" va arriba del logo en los dos casos; a la derecha, me gusta y guardar.
 */
const PlaceHeader = (props: Props) => {
  const barColor = props.logoUrl ? props.logoBgColor : null;
  const tone = barColor ? toneOn(barColor) : null;
  const bar = barColor ? ({ "--bar-bg": barColor } as CSSProperties) : undefined;

  return (
    <div className={styles.header} data-bar={barColor ? true : undefined}>
      <div className={styles.bar} style={bar}>
        <div className={styles.content}>
          <BackButton tone={tone} />
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.row}>
          <div className={styles.logo}>
            <PlaceImage name={props.name} logoUrl={props.logoUrl} logoBgColor={props.logoBgColor} size="lg" />
          </div>
          <div className={styles.like}>
            <PlaceActions
              placeId={props.placeId}
              instagramHandle={instagramHandle(props.instagram)}
              popularHref={instagramPopularHref(props.name)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlaceHeader;
