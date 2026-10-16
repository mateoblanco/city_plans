"use client";

import { AdvancedMarker, APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo } from "react";
import styles from "./SearchMap.module.scss";

export type LatLng = { lat: number; lng: number };
export type MapPlace = LatLng & { id: string; name: string };

const MONTEVIDEO = { lat: -34.9011, lng: -56.1645 };
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

type FitBoundsProps = {
  places: LatLng[];
};

/** Encuadra todos los marcadores (y la ubicación de la persona) al llegar resultados; sin nada, Montevideo. */
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
    } else {
      // Límites como literal: no depende del global `google` (ni de sus tipos en el editor).
      const lats = props.places.map((place) => place.lat);
      const lngs = props.places.map((place) => place.lng);
      map.fitBounds({ north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) }, 64);
    }
  }, [map, props.places]);

  return null;
};

type Props = {
  places: MapPlace[];
  userLocation: LatLng | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
};

const SearchMap = (props: Props) => {
  const points = useMemo(
    () => (props.userLocation ? [...props.places, props.userLocation] : props.places),
    [props.places, props.userLocation],
  );

  if (!API_KEY) return <p className={styles.mapMessage}>Mapa no disponible</p>;

  return (
    <APIProvider apiKey={API_KEY} language="es" region="UY">
      <Map mapId={MAP_ID} defaultCenter={MONTEVIDEO} defaultZoom={13} disableDefaultUI clickableIcons={false} gestureHandling="greedy">
        {props.places.map((place) => {
          const active = place.id === props.hoveredId;
          return (
            <AdvancedMarker
              key={place.id}
              position={place}
              title={place.name}
              zIndex={active ? 1 : 0}
              onClick={() => props.onSelect(place.id)}
              onMouseEnter={() => props.onHover(place.id)}
              onMouseLeave={() => props.onHover(null)}
            >
              <div className={styles.marker} data-active={active || undefined} />
            </AdvancedMarker>
          );
        })}
        {props.userLocation && (
          <AdvancedMarker position={props.userLocation} title="Tu ubicación" zIndex={2}>
            <div className={styles.userMarker} />
          </AdvancedMarker>
        )}
        <FitBounds places={points} />
      </Map>
    </APIProvider>
  );
};

export default SearchMap;
