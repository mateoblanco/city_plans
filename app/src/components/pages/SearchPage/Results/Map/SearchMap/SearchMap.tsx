"use client";

import { AdvancedMarker, APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { memo, use, useEffect, useRef, useSyncExternalStore } from "react";
import type { IconCategory } from "@shared/icon-categories.ts";
import MapMarker from "@/components/MapMarker/MapMarker";
import { useIsActiveMarker } from "../../../utils/hover";
import { SearchMapContext } from "../../../utils/use-search-map";
import { MAPS_API_KEY, MAPS_LANGUAGE, MAPS_REGION } from "./maps-loader";
import styles from "./SearchMap.module.scss";

export type LatLng = { lat: number; lng: number };
/** cardId: la card del lugar; las sucursales de una marca comparten la card y se resaltan juntas. */
export type MapPlace = LatLng & { id: string; cardId: string; name: string; iconCategory: IconCategory | null };

const MONTEVIDEO = { lat: -34.9011, lng: -56.1645 };
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;

/** Desktop: 64px de aire a cada lado al encuadrar. */
const FIT_PADDING = 64;

type FitBoundsProps = {
  places: LatLng[];
  /** Cambia con cada búsqueda nueva: sólo entonces (o cuando el mapa queda listo) se encuadra. */
  fitKey: number;
  bottomInset: number;
};

/**
 * Cuánto del mapa tapa el header, medido al encuadrar. En mobile el mapa arranca arriba de todo, debajo del header (así
 * no baja cuando el header crece con la barra de filtros: MapColumn); en desktop arranca debajo y es 0.
 */
const coveredByHeader = (map: NonNullable<ReturnType<typeof useMap>>) => {
  const header = document.querySelector("header");
  if (!header) return 0;
  return Math.max(0, Math.round(header.getBoundingClientRect().bottom - map.getDiv().getBoundingClientRect().top));
};

/**
 * Encuadra todos los marcadores (y la ubicación de la persona) al llegar una búsqueda nueva; sin nada, Montevideo. Con
 * bottomInset (mobile: lo que tapa el panel de resultados) y lo que tapa el header, encuadra en la parte del mapa que
 * queda a la vista. "Ver más" suma puntos sin mover el mapa, y el panel que sube o baja tampoco vuelve a encuadrar.
 */
const FitBounds = (props: FitBoundsProps) => {
  const map = useMap();
  // Los puntos y el inset más recientes, sin que sean dependencias del efecto.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    if (!map) return;
    const { places, bottomInset } = latest.current;
    const topInset = coveredByHeader(map);
    if (places.length === 0) {
      map.setCenter(MONTEVIDEO);
      map.setZoom(13);
    } else if (places.length === 1) {
      map.setCenter(places[0]);
      map.setZoom(15);
      // El punto, en el centro de lo que se ve entre el header y el panel.
      if (bottomInset !== topInset) map.panBy(0, (bottomInset - topInset) / 2);
    } else {
      // Límites como literal: no depende del global `google` (ni de sus tipos en el editor).
      const lats = places.map((place) => place.lat);
      const lngs = places.map((place) => place.lng);
      const bounds = { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
      map.fitBounds(
        bounds,
        bottomInset > 0
          ? { top: topInset + 32, right: 24, left: 24, bottom: bottomInset + 24 }
          : { top: topInset + FIT_PADDING, right: FIT_PADDING, left: FIT_PADDING, bottom: FIT_PADDING },
      );
    }
  }, [map, props.fitKey]);

  return null;
};

type PlaceMarkerProps = {
  place: MapPlace;
  onHover: (cardId: string | null) => void;
  onSelect: (cardId: string) => void;
};

/**
 * Un marcador por lugar, memoizado: `place` es el mismo objeto mientras no cambie y los callbacks son estables, así que
 * sólo se re-renderiza cuando su card entra o sale del resaltado (se suscribe a eso solo).
 */
const PlaceMarker = memo(function PlaceMarker(props: PlaceMarkerProps) {
  const active = useIsActiveMarker(props.place.cardId);
  const { place, onHover, onSelect } = props;
  return (
    <AdvancedMarker
      position={place}
      title={place.name}
      zIndex={active ? 1 : 0}
      onClick={() => onSelect(place.cardId)}
      onMouseEnter={() => onHover(place.cardId)}
      onMouseLeave={() => onHover(null)}
    >
      <MapMarker category={place.iconCategory} active={active} />
    </AdvancedMarker>
  );
});

type Props = {
  onHover: (cardId: string | null) => void;
  onSelect: (cardId: string) => void;
  /** Un toque en el mapa, fuera de un marcador (mobile: cierra la card flotante). */
  onMapClick?: () => void;
  /** Mobile: cuánto del mapa tapa el panel de resultados, para encuadrar en lo que queda a la vista. */
  bottomInset?: number;
};

/**
 * El mapa y sus marcadores. Lee los puntos de la búsqueda del store (SearchMapContext, lo que publica la lista): así
 * APIProvider no se vuelve a renderizar con cada búsqueda o "Ver más" (si lo hiciera, cambiaría su contexto y se
 * re-renderizarían todos los marcadores).
 */
const MapContent = (props: Props) => {
  const store = use(SearchMapContext);
  const { places, near, fitKey } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const points = near ? [...places, near] : places;
  // El mapa se crea con la primera búsqueda (Maps JS ya se viene bajando desde antes: maps-loader). Creado antes,
  // bajaría los tiles de Montevideo y después, al encuadrar, todos de nuevo.
  if (fitKey === 0) return null;

  return (
    <Map
      className={styles.map}
      mapId={MAP_ID}
      defaultCenter={MONTEVIDEO}
      defaultZoom={13}
      disableDefaultUI
      clickableIcons={false}
      gestureHandling="greedy"
      onClick={props.onMapClick}
    >
      {places.map((place) => (
        <PlaceMarker key={place.id} place={place} onHover={props.onHover} onSelect={props.onSelect} />
      ))}
      {near && (
        <AdvancedMarker position={near} title="Tu ubicación" zIndex={2}>
          <div className={styles.userMarker} />
        </AdvancedMarker>
      )}
      <FitBounds places={points} fitKey={fitKey} bottomInset={props.bottomInset ?? 0} />
    </Map>
  );
};

/**
 * Memoizado y con props estables: ni el host (MapSync, que se re-renderiza al arrastrar el panel) ni una búsqueda nueva
 * lo vuelven a renderizar; lo que cambia lo lee MapContent.
 */
const SearchMap = memo(function SearchMap(props: Props) {
  if (!MAPS_API_KEY) return <p className={styles.mapMessage}>Mapa no disponible</p>;

  return (
    <APIProvider apiKey={MAPS_API_KEY} language={MAPS_LANGUAGE} region={MAPS_REGION}>
      <MapContent {...props} />
    </APIProvider>
  );
});

export default SearchMap;
