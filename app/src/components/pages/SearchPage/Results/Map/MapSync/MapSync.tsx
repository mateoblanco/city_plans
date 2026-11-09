"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";
import type { SearchResult } from "@/server/search";
import type { LatLng, MapPlace } from "../SearchMap/SearchMap";
import MapColumn from "../MapColumn/MapColumn";
import ResultsSheet from "../../ResultsSheet/ResultsSheet";
import SelectedPlace from "../../SelectedPlace/SelectedPlace";
import { SHEET_LOW, SHEET_MID, type SheetSnapPoint } from "../../../utils/sheet";
import { cardId, HoverContext } from "../../../utils/hover";

// El mapa (y la librería de Google) se cargan sólo en el cliente: no bloquean el HTML de los resultados.
const SearchMap = dynamic(() => import("../SearchMap/SearchMap"), { ssr: false });

/** Mobile: la lista va en el panel arrastrable y tocar un marcador muestra su card flotando. */
export type MobileSheet = {
  count: number;
  snapPoint: SheetSnapPoint;
  onSnapPointChange: (snapPoint: SheetSnapPoint) => void;
};

type Props = {
  places: MapPlace[];
  /** Las cards visibles: de acá sale la card flotante del marcador tocado (mobile). */
  results: SearchResult[];
  /** Cerca mío: la ubicación (redondeada) con la que se buscó. */
  userLocation?: LatLng | null;
  /** Sin sheet, desktop: la lista en la página y el mapa en su columna. */
  sheet: MobileSheet | null;
  children: ReactNode;
};

/** Estado compartido entre la lista (children, renderizada en el server) y el mapa. */
const MapSync = (props: Props) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sheet = props.sheet;
  // Si el lugar ya no está entre los visibles (otra búsqueda), no hay card.
  const selected = sheet && selectedId ? props.results.find((place) => place.id === selectedId) : undefined;

  const select = (id: string) => {
    if (sheet) {
      // Mobile: la card flota sobre el mapa y el panel baja para dejarle lugar.
      setSelectedId(id);
      sheet.onSnapPointChange(SHEET_LOW);
      return;
    }
    setHoveredId(id);
    document.getElementById(cardId(id))?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const map = (
    <MapColumn>
      <SearchMap
        places={props.places}
        userLocation={props.userLocation ?? null}
        hoveredId={selected?.id ?? hoveredId}
        onHover={setHoveredId}
        onSelect={select}
        onMapClick={() => setSelectedId(null)}
        // El panel arranca a media pantalla: los marcadores se encuadran arriba de él (el mapa ya termina en la baja).
        bottomInset={sheet ? Math.round(window.innerHeight * SHEET_MID - parseFloat(SHEET_LOW)) : 0}
      />
    </MapColumn>
  );

  return (
    <HoverContext value={{ hoveredId, setHoveredId }}>
      {sheet ? (
        <>
          {map}
          {selected && <SelectedPlace place={selected} />}
          <ResultsSheet
            count={sheet.count}
            snapPoint={sheet.snapPoint}
            onSnapPointChange={(snapPoint) => {
              // Subir el panel cierra la card flotante.
              if (snapPoint !== SHEET_LOW) setSelectedId(null);
              sheet.onSnapPointChange(snapPoint);
            }}
          >
            {props.children}
          </ResultsSheet>
        </>
      ) : (
        <>
          {props.children}
          {map}
        </>
      )}
    </HoverContext>
  );
};

export default MapSync;
