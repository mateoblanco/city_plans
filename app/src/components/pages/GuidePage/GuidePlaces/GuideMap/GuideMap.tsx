"use client";

import { useEffect } from "react";
import { AdvancedMarker, APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import { MAPS_API_KEY, MAPS_LANGUAGE, MAPS_REGION } from "@/components/pages/SearchPage/Results/Map/SearchMap/maps-loader";
import { useGuideFocus, useIsActive } from "../../utils/guide-focus";
import { pinBounds, type GuidePin } from "../../utils/pins";
import GuideMarker from "./GuideMarker/GuideMarker";
import styles from "./GuideMap.module.scss";

// El mismo Map ID (estilo) que /search y la ficha.
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID;
const MONTEVIDEO = { lat: -34.9011, lng: -56.1645 };
const FIT_PADDING = 48;

type FitPinsProps = {
  pins: GuidePin[];
};

/** Encuadra todos los pins una vez, al crear el mapa (con uno solo, centrado y con zoom de calle). */
const FitPins = (props: FitPinsProps) => {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const bounds = pinBounds(props.pins);
    if (!bounds) return;
    if (props.pins.length === 1) {
      map.setCenter(props.pins[0]);
      map.setZoom(16);
      return;
    }
    map.fitBounds(bounds, FIT_PADDING);
    // Sólo con el mapa nuevo: el resaltado no reencuadra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  return null;
};

type PinProps = {
  pin: GuidePin;
  onSelect: (id: string) => void;
};

/** Cada pin se suscribe sólo a si es el resaltado: un hover re-renderiza dos pins. */
const Pin = (props: PinProps) => {
  const store = useGuideFocus();
  const active = useIsActive(props.pin.id);
  return (
    <AdvancedMarker
      position={props.pin}
      title={`${props.pin.number}. ${props.pin.name}`}
      zIndex={active ? 1000 : props.pin.number}
      onClick={() => props.onSelect(props.pin.id)}
      onMouseEnter={() => store.setHovered(props.pin.id)}
      onMouseLeave={() => store.setHovered(null)}
    >
      <GuideMarker number={props.pin.number} active={active} />
    </AdvancedMarker>
  );
};

type Props = {
  pins: GuidePin[];
  /** Tocar o hacer click en un pin. */
  onSelect: (id: string) => void;
  /** Desktop (al lado de la lista): cooperative, así la rueda scrollea la página; pantalla completa: greedy. */
  gestureHandling: "cooperative" | "greedy";
};

/**
 * Mapa interactivo de la guía (Maps JS con @vis.gl, como /search y la ficha), con los pins numerados. Se carga sólo en
 * el cliente (next/dynamic) y sólo cuando se va a ver: en desktop con useDeferredMount, en mobile al tocar "Ver mapa".
 */
const GuideMap = (props: Props) => {
  if (!MAPS_API_KEY) return <p className={styles.message}>Mapa no disponible</p>;
  // Arranca centrado en los pins (FitPins después ajusta el zoom): no baja primero los tiles de otra zona.
  const bounds = pinBounds(props.pins);
  const center = bounds ? { lat: (bounds.north + bounds.south) / 2, lng: (bounds.east + bounds.west) / 2 } : MONTEVIDEO;

  return (
    <APIProvider apiKey={MAPS_API_KEY} language={MAPS_LANGUAGE} region={MAPS_REGION}>
      <Map
        className={styles.map}
        mapId={MAP_ID}
        defaultCenter={center}
        defaultZoom={14}
        disableDefaultUI
        zoomControl
        gestureHandling={props.gestureHandling}
        clickableIcons={false}
      >
        <FitPins pins={props.pins} />
        {props.pins.map((pin) => (
          <Pin key={pin.id} pin={pin} onSelect={props.onSelect} />
        ))}
      </Map>
    </APIProvider>
  );
};

export default GuideMap;
