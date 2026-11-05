import type { IconCategory } from "@shared/icon-categories.ts";
import PlaceIcon from "@/components/PlaceIcon/PlaceIcon";
import { MARKER_ICONS } from "@/components/pages/SearchPage/Results/Map/SearchMap/marker-icons";
import styles from "./MapMarker.module.scss";

type MarkerIconProps = {
  category: IconCategory | null;
};

/** SVG de la categoría; sin categoría o sin archivo, el emoji de PlaceIcon. El nombre accesible es el title del marcador. */
const MarkerIcon = (props: MarkerIconProps) => {
  const icon = props.category ? MARKER_ICONS[props.category] : undefined;
  if (!icon) return <PlaceIcon category={props.category} />;
  // <img> y no next/image: un SVG no se optimiza y la misma URL con hash la cachea el navegador.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.markerIcon} src={icon.src} alt="" width={20} height={20} draggable={false} decoding="async" />;
};

type Props = {
  category: IconCategory | null;
  /** Resaltado (hover sincronizado con la card en /search): más grande y con anillo. */
  active?: boolean;
};

/** Círculo blanco con el ícono de la categoría: el marcador de los mapas (/search y la ficha del lugar). */
const MapMarker = (props: Props) => (
  <div className={styles.marker} data-active={props.active || undefined}>
    <MarkerIcon category={props.category} />
  </div>
);

export default MapMarker;
