"use client";

import dynamic from "next/dynamic";
import { createContext, use, useState, type ReactNode } from "react";
import type { MapPlace } from "./SearchMap";
import styles from "./SearchPage.module.scss";

type HoverState = { hoveredId: string | null; setHoveredId: (id: string | null) => void };

const HoverContext = createContext<HoverState>({ hoveredId: null, setHoveredId: () => {} });

export const useHoveredPlace = () => use(HoverContext);

// El mapa (y la librería de Google) se cargan sólo en el cliente: no bloquean el HTML de los resultados.
const SearchMap = dynamic(() => import("./SearchMap"), { ssr: false });

export const cardId = (id: string) => `place-${id}`;

type MapSyncProps = {
  places: MapPlace[];
  children: ReactNode;
};

/** Estado compartido entre la lista (children, renderizada en el server) y el mapa. */
const MapSync = ({ places, children }: MapSyncProps) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const select = (id: string) => {
    setHoveredId(id);
    document.getElementById(cardId(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <HoverContext value={{ hoveredId, setHoveredId }}>
      {children}
      <aside className={styles.map} aria-label="Mapa de resultados">
        <SearchMap places={places} hoveredId={hoveredId} onHover={setHoveredId} onSelect={select} />
      </aside>
    </HoverContext>
  );
};

export default MapSync;
