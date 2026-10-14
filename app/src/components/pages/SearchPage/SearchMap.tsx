"use client";

import { AdvancedMarker, APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { useEffect, useMemo } from "react";
import styles from "./SearchPage.module.scss";

export type LatLng = { lat: number; lng: number };
export type MapPlace = LatLng & { id: string; name: string };

const MONTEVIDEO = { lat: -34.9011, lng: -56.1645 };
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

type SearchMapProps = {
  places: MapPlace[];
  userLocation: LatLng | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
};

/** Encuadra todos los marcadores (y la ubicación de la persona) al llegar resultados; sin nada, Montevideo. */
const FitBounds = ({ places }: { places: LatLng[] }) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    if (places.length === 0) {
      map.setCenter(MONTEVIDEO);
      map.setZoom(13);
    } else if (places.length === 1) {
      map.setCenter(places[0]);
      map.setZoom(15);
    } else {
      const bounds = new google.maps.LatLngBounds();
      for (const place of places) bounds.extend(place);
      map.fitBounds(bounds, 64);
    }
  }, [map, places]);

  return null;
};

const SearchMap = ({ places, userLocation, hoveredId, onHover, onSelect }: SearchMapProps) => {
  const points = useMemo(() => (userLocation ? [...places, userLocation] : places), [places, userLocation]);

  if (!API_KEY) return <p className={styles.mapMessage}>Mapa no disponible</p>;

  return (
    <APIProvider apiKey={API_KEY} language="es" region="UY">
      <Map mapId={MAP_ID} defaultCenter={MONTEVIDEO} defaultZoom={13} disableDefaultUI clickableIcons={false} gestureHandling="greedy">
        {places.map((place) => {
          const active = place.id === hoveredId;
          return (
            <AdvancedMarker
              key={place.id}
              position={place}
              title={place.name}
              zIndex={active ? 1 : 0}
              onClick={() => onSelect(place.id)}
              onMouseEnter={() => onHover(place.id)}
              onMouseLeave={() => onHover(null)}
            >
              <div className={styles.marker} data-active={active || undefined} />
            </AdvancedMarker>
          );
        })}
        {userLocation && (
          <AdvancedMarker position={userLocation} title="Tu ubicación" zIndex={2}>
            <div className={styles.userMarker} />
          </AdvancedMarker>
        )}
        <FitBounds places={points} />
      </Map>
    </APIProvider>
  );
};

export default SearchMap;
