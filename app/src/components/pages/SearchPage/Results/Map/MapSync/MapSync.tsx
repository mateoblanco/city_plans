"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { preconnect } from "react-dom";
import MapColumn from "../MapColumn/MapColumn";
import { startMapsLoad } from "../SearchMap/maps-loader";
import ResultsAnnouncer from "../../ResultsAnnouncer/ResultsAnnouncer";
import ResultsSheet from "../../ResultsSheet/ResultsSheet";
import SelectedPlace from "../../SelectedPlace/SelectedPlace";
import { SHEET_HIGH, SHEET_LOW, SHEET_MID, type SheetSnapPoint } from "../../../utils/sheet";
import { cardId, createHoverStore, HoverContext } from "../../../utils/hover";
import { createSearchMapStore, INITIAL_SEARCH_MAP_STATE } from "../../../utils/search-map-store";
import { SearchMapContext } from "../../../utils/use-search-map";
import { useMobile } from "../../../utils/use-mobile";

// El mapa (y la librería de Google) se cargan sólo en el cliente: no bloquean el HTML de los resultados. Mientras
// tanto se ve el fondo de MapColumn.
const SearchMap = dynamic(() => import("../SearchMap/SearchMap"), { ssr: false });

type Props = {
  /** La lista: el Suspense de la búsqueda (con su key), renderizado en el server. */
  children: ReactNode;
};

/**
 * El mapa de /search y el estado compartido con la lista. Vive fuera del Suspense con key de la búsqueda: se monta
 * una vez y cada búsqueda o filtro sólo le pasa sus puntos (la lista los publica en SearchMapContext). También es el
 * dueño del panel de mobile (ResultsSheet, siempre montado): su altura no se pierde al cambiar un filtro.
 */
const MapSync = (props: Props) => {
  const [hover] = useState(createHoverStore);
  const [store] = useState(createSearchMapStore);
  const state = useSyncExternalStore(store.subscribe, store.getState, () => INITIAL_SEARCH_MAP_STATE);
  const mobile = useMobile();
  const [snapPoint, setSnapPoint] = useState<SheetSnapPoint>(SHEET_MID);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Maps JS lo antes posible, sin esperar el chunk de SearchMap (no bloquea: es un script async).
  preconnect("https://maps.googleapis.com");
  preconnect("https://maps.gstatic.com", { crossOrigin: "anonymous" });
  useEffect(startMapsLoad, []);

  // Mobile: si el lugar ya no está entre los visibles (otra búsqueda), no hay card.
  const selected = mobile && selectedId ? state.results.find((place) => place.id === selectedId) : undefined;
  const selectedVisible = selected?.id ?? null;
  useEffect(() => {
    hover.setSelected(selectedVisible);
  }, [hover, selectedVisible]);

  // Los callbacks del mapa son estables (leen mobile con una ref): el mapa y sus marcadores no se re-renderizan
  // cuando el host lo hace (por ejemplo, al arrastrar el panel).
  const mobileRef = useRef(mobile);
  useEffect(() => {
    mobileRef.current = mobile;
  }, [mobile]);

  const select = useCallback(
    (id: string) => {
      if (mobileRef.current) {
        // Mobile: la card flota sobre el mapa y el panel baja para dejarle lugar.
        setSelectedId(id);
        setSnapPoint(SHEET_LOW);
        return;
      }
      hover.setHovered(id);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(cardId(id))?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    },
    [hover],
  );
  const closeSelected = useCallback(() => setSelectedId(null), []);
  const changeSnapPoint = useCallback((next: SheetSnapPoint) => {
    // Subir el panel cierra la card flotante.
    if (next !== SHEET_LOW) setSelectedId(null);
    setSnapPoint(next);
  }, []);

  // El panel arranca a media pantalla: los marcadores se encuadran arriba de él (el mapa ya termina en la baja).
  const bottomInset = useMemo(() => (mobile ? Math.round(window.innerHeight * SHEET_MID - parseFloat(SHEET_LOW)) : 0), [mobile]);

  const map = (
    <MapColumn>
      <SearchMap
        onHover={hover.setHovered}
        onSelect={select}
        onMapClick={closeSelected}
        bottomInset={bottomInset}
      />
    </MapColumn>
  );

  // Mobile: el panel (Drawer) se monta con la primera búsqueda que llega y después queda montado para las siguientes.
  // Antes, la lista y su skeleton ya se ven como el panel a media altura (CSS de ResultsView y ResultsSkeleton). Si el
  // Drawer se montara de entrada, mediría su alto con el header todavía sin la barra de filtros (llega con la búsqueda)
  // y el panel saltaría.
  const sheet = mobile && state.fitKey > 0;

  // Con el panel en la alta, el header esconde la barra de filtros (Header.module.scss, html[data-sheet-high]): la
  // lista gana ese alto (el popup mide siempre hasta el header sin esa barra: --header-offset-collapsed, HeaderOffset).
  const sheetHigh = sheet && snapPoint === SHEET_HIGH;
  useEffect(() => {
    if (!sheetHigh) return;
    const root = document.documentElement;
    root.dataset.sheetHigh = "";
    return () => {
      delete root.dataset.sheetHigh;
    };
  }, [sheetHigh]);

  // Cada cosa en su lugar fijo del árbol: el mapa nunca se vuelve a montar (ni al pasar la lista al panel).
  return (
    <SearchMapContext value={store}>
      <HoverContext value={hover}>
        <ResultsAnnouncer pending={state.pending} count={state.count} nearby={state.nearby} fitKey={state.fitKey} />
        {!sheet && props.children}
        {map}
        {selected && <SelectedPlace place={selected} />}
        {sheet && (
          <ResultsSheet count={state.pending ? null : state.count} nearby={state.nearby} snapPoint={snapPoint} onSnapPointChange={changeSnapPoint}>
            {props.children}
          </ResultsSheet>
        )}
      </HoverContext>
    </SearchMapContext>
  );
};

export default MapSync;
