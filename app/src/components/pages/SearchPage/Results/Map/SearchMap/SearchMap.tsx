"use client";

import { AdvancedMarker, APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo } from "react";
import type { IconCategory } from "@shared/icon-categories.ts";
import MapMarker from "@/components/MapMarker/MapMarker";
import styles from "./SearchMap.module.scss";

export type LatLng = { lat: number; lng: number };
/** cardId: la card del lugar; las sucursales de una marca comparten la card y se resaltan juntas. */
export type MapPlace = LatLng & { id: string; cardId: string; name: string; iconCategory: IconCategory | null };

const MONTEVIDEO = { lat: -34.9011, lng: -56.1645 };
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

/** Desktop: 64px de aire a cada lado al encuadrar. */
const FIT_PADDING = 64;

type FitBoundsProps = {
  places: LatLng[];
  bottomInset: number;
};

/**
 * Encuadra todos los marcadores (y la ubicación de la persona) al llegar resultados; sin nada, Montevideo. Con
 * bottomInset (mobile: lo que tapa el panel de resultados), encuadra en la parte del mapa que queda a la vista.
 */
const FitBounds = (props: FitBoundsProps) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    if (props.places.length === 0) {
      map.setCenter(MONTEVIDEO);
      map.setZoom(13);
    } else if (props.places.length === 1) {
      map.setCenter(props.places[0]);
      map.setZoom(15);
      // El punto, en el centro de lo que se ve arriba del panel.
      if (props.bottomInset > 0) map.panBy(0, props.bottomInset / 2);
    } else {
      // Límites como literal: no depende del global `google` (ni de sus tipos en el editor).
      const lats = props.places.map((place) => place.lat);
      const lngs = props.places.map((place) => place.lng);
      const bounds = { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
      map.fitBounds(bounds, props.bottomInset > 0 ? { top: 32, right: 24, left: 24, bottom: props.bottomInset + 24 } : FIT_PADDING);
    }
    // Sólo al cambiar los lugares: el panel que sube o baja después no vuelve a encuadrar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, props.places]);

  return null;
};

type Props = {
  places: MapPlace[];
  userLocation: LatLng | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  /** Un toque en el mapa, fuera de un marcador (mobile: cierra la card flotante). */
  onMapClick?: () => void;
  /** Mobile: cuánto del mapa tapa el panel de resultados, para encuadrar en lo que queda a la vista. */
  bottomInset?: number;
};

const SearchMap = (props: Props) => {
  const points = useMemo(
    () => (props.userLocation ? [...props.places, props.userLocation] : props.places),
    [props.places, props.userLocation],
  );

  if (!API_KEY) return <p className={styles.mapMessage}>Mapa no disponible</p>;

  return (
    <APIProvider apiKey={API_KEY} language="es" region="UY">
      <Map className={styles.map} mapId={MAP_ID} defaultCenter={MONTEVIDEO} defaultZoom={13} disableDefaultUI clickableIcons={false} gestureHandling="greedy" onClick={() => props.onMapClick?.()}>
        {props.places.map((place) => {
          const active = place.cardId === props.hoveredId;
          return (
            <AdvancedMarker
              key={place.id}
              position={place}
              title={place.name}
              zIndex={active ? 1 : 0}
              onClick={() => props.onSelect(place.cardId)}
              onMouseEnter={() => props.onHover(place.cardId)}
              onMouseLeave={() => props.onHover(null)}
            >
              <MapMarker category={place.iconCategory} active={active} />
            </AdvancedMarker>
          );
        })}
        {props.userLocation && (
          <AdvancedMarker position={props.userLocation} title="Tu ubicación" zIndex={2}>
            <div className={styles.userMarker} />
          </AdvancedMarker>
        )}
        <FitBounds places={points} bottomInset={props.bottomInset ?? 0} />
      </Map>
    </APIProvider>
  );
};

export default SearchMap;
