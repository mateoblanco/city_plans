import type { StaticMapSource } from "@/server/places/static-map";
import DirectionsTracker from "@/components/Tracking/DirectionsTracker/DirectionsTracker";
import { PLACE_MAP_DESKTOP_MIN_WIDTH } from "@/lib/place-map";
import styles from "./StaticMap.module.scss";

/** GIF transparente de 1×1: desde ml el <picture> elige este y el navegador no pide la imagen de Google. */
const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Props = {
  name: string;
  /** Una por tramo de ancho de pantalla, de menor a mayor (staticMapSources); vacío: no se dibuja nada. */
  sources: StaticMapSource[];
  /** El link "Google Maps" de PlaceLocation; null sin google_place_id (la imagen va sin link). */
  mapsHref: string | null;
  /** Con TRACK_EVENTS, tocar la imagen cuenta como "Cómo llegar", como el link. */
  trackPlaceId: string | null;
  /** fetchpriority="high": el mapa probablemente entra en la primera pantalla (mapLikelyAboveFold). */
  priority: boolean;
};

/**
 * La ficha en mobile (debajo de ml): una imagen de Static Maps en lugar del mapa de Maps JS, con el mismo Map ID, el
 * mismo zoom y el marcador como PNG. La pide el navegador directo a Google (URL firmada armada en el servidor): no pasa
 * por nuestro servidor ni por next/image, y no se guarda. La atribución de Google va dentro de la imagen. Sin JS: el
 * <source media> elige el tamaño del recuadro.
 */
const StaticMap = (props: Props) => {
  if (props.sources.length === 0) return null;
  const smallest = props.sources[0];

  const picture = (
    <picture className={styles.picture}>
      <source media={`(min-width: ${PLACE_MAP_DESKTOP_MIN_WIDTH}px)`} srcSet={EMPTY_IMAGE} />
      {props.sources
        .slice(1)
        .reverse()
        .map((source) => (
          <source key={source.minViewport} media={`(min-width: ${source.minViewport}px)`} srcSet={source.url} width={source.width} height={source.height} />
        ))}
      <source srcSet={smallest.url} width={smallest.width} height={smallest.height} />
      {/* El src es el GIF vacío y la imagen sale siempre de un <source>: al hacer streaming, React puede mandar el <img>
          en otro pedazo del HTML, y el navegador lo parsea un momento fuera del <picture>; con una URL de Google en src
          la bajaría ahí (también en desktop). <img> y no next/image: la imagen es de Google y no pasa por nuestro
          servidor. */}
      <img
        className={styles.image}
        src={EMPTY_IMAGE}
        width={smallest.width}
        height={smallest.height}
        alt={props.mapsHref ? "" : `Mapa con la ubicación de ${props.name}`}
        loading="eager"
        decoding="async"
        fetchPriority={props.priority ? "high" : undefined}
      />
    </picture>
  );

  if (!props.mapsHref) return picture;

  // El nombre accesible es el del link (la imagen va con alt vacío para no repetirlo).
  const link = (
    <a className={styles.link} href={props.mapsHref} target="_blank" rel="noopener noreferrer" aria-label={`Mapa con la ubicación de ${props.name}: abrir en Google Maps (otra pestaña)`}>
      {picture}
    </a>
  );
  return props.trackPlaceId ? <DirectionsTracker placeId={props.trackPlaceId}>{link}</DirectionsTracker> : link;
};

export default StaticMap;
