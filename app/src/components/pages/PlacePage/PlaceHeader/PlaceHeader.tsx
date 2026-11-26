import type { CSSProperties } from "react";
import PlaceImage from "@/components/pages/SearchPage/Results/PlaceCard/PlaceImage/PlaceImage";
import BackButton from "./BackButton/BackButton";
import PlaceActions from "./PlaceActions/PlaceActions";
import ShareButton from "./ShareButton/ShareButton";
import { instagramHandle, instagramPopularHref, isNearWhite, toneOn } from "../utils/summary";
import { placeShareUrl } from "../utils/share";
import styles from "./PlaceHeader.module.scss";

type Props = {
  placeId: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  logoBgColor: string | null;
  instagram: string | null;
};

/**
 * Encabezado de la ficha: con logo, una barra del color del logo y el logo encima; sin logo, sin barra y lo mismo que
 * muestra la card (el nombre). "← Volver" va arriba del logo en los dos casos; a la derecha, "Compartir" y "Guardar" (el
 * corazón), que queda en el borde. Las dos son islas de cliente chicas; el resto es del servidor.
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
            <PlaceImage name={props.name} logoUrl={props.logoUrl} logoBgColor={props.logoBgColor} size="lg" onLightBar={isNearWhite(barColor)} load="high" />
          </div>
          <div className={styles.like}>
            <ShareButton title={props.name} url={placeShareUrl(props.slug)} place={{ id: props.placeId, slug: props.slug }} />
            <PlaceActions
              placeId={props.placeId}
              slug={props.slug}
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
