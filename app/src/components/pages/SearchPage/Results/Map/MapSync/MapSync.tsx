"use client";

import dynamic from "next/dynamic";
import { createContext, use, useState, type ReactNode } from "react";
import type { LatLng, MapPlace } from "../SearchMap/SearchMap";
import MapColumn from "../MapColumn/MapColumn";

type HoverState = { hoveredId: string | null; setHoveredId: (id: string | null) => void };

const HoverContext = createContext<HoverState>({ hoveredId: null, setHoveredId: () => {} });

export const useHoveredPlace = () => use(HoverContext);

// El mapa (y la librería de Google) se cargan sólo en el cliente: no bloquean el HTML de los resultados.
const SearchMap = dynamic(() => import("../SearchMap/SearchMap"), { ssr: false });

export const cardId = (id: string) => `place-${id}`;

type Props = {
  places: MapPlace[];
  /** Cerca mío: la ubicación (redondeada) con la que se buscó. */
  userLocation?: LatLng | null;
  children: ReactNode;
};

/** Estado compartido entre la lista (children, renderizada en el server) y el mapa. */
const MapSync = (props: Props) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const select = (id: string) => {
    setHoveredId(id);
    document.getElementById(cardId(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <HoverContext value={{ hoveredId, setHoveredId }}>
      {props.children}
      <MapColumn>
        <SearchMap places={props.places} userLocation={props.userLocation ?? null} hoveredId={hoveredId} onHover={setHoveredId} onSelect={select} />
      </MapColumn>
    </HoverContext>
  );
};

export default MapSync;
