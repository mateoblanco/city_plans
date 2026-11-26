import type { IconCategory } from "@shared/icon-categories.ts";
import PlaceIcon from "@/components/PlaceIcon/PlaceIcon";
import { MARKER_ICONS } from "@/components/pages/SearchPage/Results/Map/SearchMap/marker-icons";
import styles from "./MapMarker.module.scss";

type MarkerIconProps = {
  category: IconCategory | null;
};

/** Ícono de la categoría (WebP); sin categoría o sin archivo, el emoji de PlaceIcon. El nombre accesible es el title del marcador. */
const MarkerIcon = (props: MarkerIconProps) => {
  const icon = props.category ? MARKER_ICONS[props.category] : undefined;
  if (!icon) return <PlaceIcon category={props.category} />;
  // <img> y no next/image: el archivo ya está al tamaño justo (90×90) y la misma URL con hash la cachea el navegador.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.markerIcon} src={icon.src} alt="" width={20} height={20} draggable={false} decoding="async" />;
};

type Props = {
  category: IconCategory | null;
  /** Resaltado (hover sincronizado con la card en /search): más grande y con anillo. */
  active?: boolean;
};

/**
 * El marcador de los mapas (/search y la ficha del lugar): círculo blanco con el ícono de la categoría. Activo, sube,
 * crece y aparecen un piquito (detrás del círculo) y un punto chico, que es donde está el lugar. El contenido siempre
 * tiene el alto del activo y AdvancedMarker ancla su borde de abajo: el punto sobresale la mitad (margen negativo), así
 * su centro es la posición; inactivo, el globo baja hasta que el borde de abajo del círculo queda ahí, como siempre.
 */
const MapMarker = (props: Props) => (
  <div className={styles.marker} data-active={props.active || undefined}>
    <div className={styles.pin}>
      <div className={styles.tail} />
      <div className={styles.bubble}>
        <MarkerIcon category={props.category} />
      </div>
    </div>
    <div className={styles.dot} />
  </div>
);

export default MapMarker;
