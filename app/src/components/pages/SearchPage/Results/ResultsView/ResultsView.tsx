"use client";

import { useState, type ReactNode } from "react";
import type { LatLng, SearchResponse } from "@/server/search";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import PlacesGrid from "../PlacesGrid/PlacesGrid";
import ResultSections from "../ResultSections/ResultSections";
import MapSync from "../Map/MapSync/MapSync";
import LoadMore from "../LoadMore/LoadMore";
import EndOfResults from "../EndOfResults/EndOfResults";
import styles from "./ResultsView.module.scss";
import { mapPlaces, visiblePage } from "../../utils/pagination";
import type { SearchUrl } from "../../utils/search-href";

type Props = {
  results: SearchResponse["results"];
  sections: SearchResponse["sections"];
  forYou: SearchResponse["forYou"];
  /** Avisos de relajación, en lenguaje de usuario. */
  notices: string[];
  scores: Map<string, CardDebug> | null;
  near: LatLng | null;
  state: SearchUrl;
  /** El panel de debug, renderizado en el server. */
  children?: ReactNode;
};

/**
 * Lista y mapa de una búsqueda. La respuesta trae todos los resultados: el scroll infinito suma la página siguiente
 * sin volver a buscar, y el mapa muestra sólo las cards visibles. Al llegar al final, el aviso de que no hay más.
 */
const ResultsView = (props: Props) => {
  const [pages, setPages] = useState(1);
  const page = visiblePage(props, pages);

  return (
    <MapSync places={mapPlaces(page.places)} userLocation={props.near}>
      <div className={styles.results}>
        {props.notices.length > 0 && (
          <div className={styles.notices}>
            {props.notices.map((message) => (
              <p key={message} className={styles.notice} role="status">
                {message}
              </p>
            ))}
          </div>
        )}

        {props.results.length === 0 ? (
          <div className={styles.empty}>{props.notices.length === 0 && <p>No encontramos lugares para esta búsqueda.</p>}</div>
        ) : page.sections ? (
          // Búsqueda amplia: grupos con título y "Más opciones", que es lo único que pagina.
          <ResultSections sections={page.sections} scores={props.scores} state={props.state} />
        ) : (
          // Una sola grilla: los que tienen el plato ya vienen primero, y los "maybe" lo dicen en la card
          // ("Puede que tengan pizza", en sus motivos). Con perfil, la fila "Para vos" arriba, sin repetirse abajo.
          <>
            {page.forYou && <ResultSections sections={[page.forYou]} scores={props.scores} state={props.state} />}
            <PlacesGrid places={page.list ?? []} scores={props.scores} />
          </>
        )}

        {page.hasMore ? (
          <LoadMore key={pages} onReach={() => setPages((current) => current + 1)} />
        ) : (
          props.results.length > 0 && <EndOfResults />
        )}

        {props.children}
      </div>
    </MapSync>
  );
};

export default ResultsView;
