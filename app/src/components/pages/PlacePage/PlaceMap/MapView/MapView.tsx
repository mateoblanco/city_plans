"use client";

import { AdvancedMarker, APIProvider, Map } from "@vis.gl/react-google-maps";
import type { IconCategory } from "@shared/icon-categories.ts";
import MapMarker from "@/components/MapMarker/MapMarker";
import { useMobile } from "@/components/pages/SearchPage/utils/use-mobile";
import styles from "./MapView.module.scss";

// La misma clave de navegador (restringida por referrer) y el mismo Map ID que el mapa de /search.
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
const ZOOM = 16;

type Props = {
  name: string;
  lat: number;
  lng: number;
  iconCategory: IconCategory | null;
};

/** No interactivo: sin arrastrar, zoom, teclado ni controles. El logo y los términos de Google quedan visibles. */
const MapView = (props: Props) => {
  // Mobile: quieto, así no le roba el scroll a la página.
  const mobile = useMobile("ml");
  if (!API_KEY) return <p className={styles.mapMessage}>Mapa no disponible</p>;
  const position = { lat: props.lat, lng: props.lng };

  return (
    <APIProvider apiKey={API_KEY} language="es" region="UY">
      <Map
        className={styles.map}
        mapId={MAP_ID}
        defaultCenter={position}
        defaultZoom={ZOOM}
        disableDefaultUI
        gestureHandling={mobile ? "none" : "greedy"}
        keyboardShortcuts={false}
        clickableIcons={false}
      >
        <AdvancedMarker position={position} title={props.name}>
          <MapMarker category={props.iconCategory} active={true}/>
        </AdvancedMarker>
      </Map>
    </APIProvider>
  );
};

export default MapView;
