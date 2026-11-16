"use client";

import { AdvancedMarker, APIProvider, Map } from "@vis.gl/react-google-maps";
import type { IconCategory } from "@shared/icon-categories.ts";
import MapMarker from "@/components/MapMarker/MapMarker";
import { PLACE_MAP_ZOOM } from "@/lib/place-map";
import styles from "./MapView.module.scss";

// La misma clave de navegador (restringida por referrer) y el mismo Map ID que el mapa de /search.
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

type Props = {
  name: string;
  lat: number;
  lng: number;
  iconCategory: IconCategory | null;
};

/**
 * Sin zoom, teclado ni controles; se puede arrastrar. El logo y los términos de Google quedan visibles. Sólo en desktop
 * (desde ml): en mobile va la imagen de Static Maps (StaticMap).
 */
const MapView = (props: Props) => {
  if (!API_KEY) return <p className={styles.mapMessage}>Mapa no disponible</p>;
  const position = { lat: props.lat, lng: props.lng };

  return (
    <APIProvider apiKey={API_KEY} language="es" region="UY">
      <Map
        className={styles.map}
        mapId={MAP_ID}
        defaultCenter={position}
        defaultZoom={PLACE_MAP_ZOOM}
        disableDefaultUI
        gestureHandling="greedy"
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
