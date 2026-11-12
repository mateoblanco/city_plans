"use client";

import { AdvancedMarker, APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { memo, use, useEffect, useRef, useSyncExternalStore, type RefObject } from "react";
import type { Bounds } from "@/lib/location";
import type { IconCategory } from "@shared/icon-categories.ts";
import MapMarker from "@/components/MapMarker/MapMarker";
import { useIsActiveMarker } from "../../../utils/hover";
import { SearchMapContext } from "../../../utils/use-search-map";
import { movedEnough } from "../../../utils/viewport";
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
  /** "Zona del mapa": no se reencuadra (salvo la primera vez: un link compartido encuadra la zona). */
  zone: Bounds | null;
  camera: RefObject<CameraState>;
};

/**
 * Lo que hizo el programa con la cámara, para distinguirlo de lo que hizo la persona: programmatic mientras dura un
 * encuadre (hasta el próximo idle o un tope de tiempo) y reference, la vista después del último encuadre o búsqueda.
 */
type CameraState = { programmatic: boolean; reference: Bounds | null; fitted: boolean; timer: ReturnType<typeof setTimeout> | null };

type GoogleMap = NonNullable<ReturnType<typeof useMap>>;

const boundsOf = (map: GoogleMap): Bounds | null => {
  const bounds = map.getBounds();
  if (!bounds) return null;
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  return { south: sw.lat(), west: sw.lng(), north: ne.lat(), east: ne.lng() };
};

/** Marca el encuadre que viene como del programa; si la cámara no cambia (no hay idle), lo suelta igual. */
const startProgrammatic = (map: GoogleMap, camera: CameraState) => {
  camera.programmatic = true;
  if (camera.timer) clearTimeout(camera.timer);
  camera.timer = setTimeout(() => {
    camera.programmatic = false;
    camera.reference = boundsOf(map);
  }, 1500);
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
    const { places, bottomInset, zone, camera } = latest.current;
    const fitted = camera.current.fitted;
    camera.current.fitted = true;
    // Buscar en una zona no mueve el mapa: la persona ya eligió la vista. Esa vista pasa a ser la referencia.
    if (zone && fitted) {
      camera.current.reference = boundsOf(map);
      return;
    }
    startProgrammatic(map, camera.current);
    const topInset = coveredByHeader(map);
    if (zone) {
      map.fitBounds({ north: zone.north, south: zone.south, east: zone.east, west: zone.west }, 0);
    } else if (places.length === 0) {
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

type ViewportWatcherProps = {
  camera: RefObject<CameraState>;
  onMoved: (bounds: Bounds) => void;
};

/**
 * Cuando el mapa queda quieto (idle): si fue un encuadre del programa, esa vista es la referencia; si lo movió la
 * persona (arrastre o zoom) lo suficiente, avisa el área visible ("Buscar en esta zona"). Mover el mapa no busca.
 */
const ViewportWatcher = (props: ViewportWatcherProps) => {
  const map = useMap();
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      const camera = latest.current.camera.current;
      const bounds = boundsOf(map);
      if (!bounds) return;
      if (camera.programmatic || !camera.reference) {
        if (camera.timer) clearTimeout(camera.timer);
        camera.programmatic = false;
        camera.reference = bounds;
        return;
      }
      if (movedEnough(camera.reference, bounds)) latest.current.onMoved(bounds);
    });
    return () => listener.remove();
  }, [map]);
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
  const { places, near, fitKey, zone } = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const points = near ? [...places, near] : places;
  const camera = useRef<CameraState>({ programmatic: false, reference: null, fitted: false, timer: null });
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
      <FitBounds places={points} fitKey={fitKey} bottomInset={props.bottomInset ?? 0} zone={zone} camera={camera} />
      <ViewportWatcher camera={camera} onMoved={store.setViewport} />
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
