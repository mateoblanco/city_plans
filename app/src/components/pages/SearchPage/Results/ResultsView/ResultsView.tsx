"use client";

import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";
import { SKIP_TARGETS } from "@/components/SkipLinks/utils/skip-targets";
import type { LatLng, SearchResponse } from "@/server/search";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import PlacesGrid from "../PlacesGrid/PlacesGrid";
import ResultSections from "../ResultSections/ResultSections";
import LoadMore from "../LoadMore/LoadMore";
import EndOfResults from "../EndOfResults/EndOfResults";
import styles from "./ResultsView.module.scss";
import { visiblePage } from "../../utils/pagination";
import type { NearbyCount } from "../../utils/results-count";
import { EAGER_SEARCH_CARDS } from "../../utils/eager-images";
import type { SearchUrl } from "../../utils/search-href";
import { usePublishSearchResults } from "../../utils/use-search-map";

type Props = {
  results: SearchResponse["results"];
  sections: SearchResponse["sections"];
  forYou: SearchResponse["forYou"];
  /** "Cerca de <barrio>": el grupo del final. */
  nearby?: SearchResponse["nearby"];
  /** El "Ver todos" de "Cerca de": la lista va bajo su título. */
  nearbyOnly?: SearchResponse["nearbyOnly"];
  /** Avisos de relajación, en lenguaje de usuario. */
  notices: string[];
  scores: Map<string, CardDebug> | null;
  near: LatLng | null;
  state: SearchUrl;
  /** El panel de debug, renderizado en el server. */
  children?: ReactNode;
};

/**
 * La lista de una búsqueda. La respuesta trae todos los resultados: el scroll infinito suma la página siguiente sin
 * volver a buscar, y el mapa muestra sólo las cards visibles. Al llegar al final, el aviso de que no hay más.
 * El mapa y el panel de mobile (ResultsSheet) están afuera, en MapSync: se vuelve a montar sólo esta lista con cada
 * búsqueda o filtro, y le publica al mapa lo visible.
 */
const ResultsView = (props: Props) => {
  const [pages, setPages] = useState(1);
  const { results, sections, forYou, nearby = null, nearbyOnly = null } = props;
  const page = useMemo(() => visiblePage({ results, sections, forYou, nearby }, pages), [results, sections, forYou, nearby, pages]);
  const nearbyCount = useMemo((): NearbyCount | null => {
    if (nearbyOnly) return { label: nearbyOnly.label, count: results.length, only: true };
    return nearby ? { label: nearby.label, count: nearby.total, only: false } : null;
  }, [nearby, nearbyOnly, results.length]);
  usePublishSearchResults(page.places, props.near, props.results.length, nearbyCount);
  const anyResults = props.results.length > 0 || nearby !== null;
  // Con grupos, el StickyHeader pone el aire de arriba; sin ellos lo pone el contenedor.
  const grouped = props.results.length > 0 && Boolean(page.sections ?? page.forYou ?? nearbyOnly);

  return (
    <div id={SKIP_TARGETS.results} className={clsx(styles.results, !grouped && styles.ungrouped)} data-skip-target>
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
        <div className={styles.empty}>{props.notices.length === 0 && !nearby && <p>No encontramos lugares para esta búsqueda.</p>}</div>
      ) : nearbyOnly ? (
        // "Ver todos" de "Cerca de": la lista bajo su título, de a 12 con "Ver más".
        <ResultSections
          sections={[{ id: "nearby-all", title: nearbyOnly.title, places: page.list ?? [], total: null }]}
          scores={props.scores}
          state={props.state}
          eagerCount={EAGER_SEARCH_CARDS}
        />
      ) : page.sections ? (
        // Búsqueda amplia: grupos con título y "Más opciones", que es lo único que pagina.
        <ResultSections sections={page.sections} scores={props.scores} state={props.state} eagerCount={EAGER_SEARCH_CARDS} />
      ) : (
        // Una sola grilla: los que tienen el plato ya vienen primero, y los "maybe" lo dicen en la card
        // ("Puede que tengan pizza", en sus motivos). Con perfil, la fila "Para vos" arriba, sin repetirse abajo.
        <>
          {/* El primer grupo es "Para vos" si está; si no, la grilla. */}
          {page.forYou && <ResultSections sections={[page.forYou]} scores={props.scores} state={props.state} eagerCount={EAGER_SEARCH_CARDS} />}
          <PlacesGrid places={page.list ?? []} scores={props.scores} eagerCount={page.forYou ? undefined : EAGER_SEARCH_CARDS} />
        </>
      )}

      {/* "Cerca de <barrio>": al final de todo (visiblePage lo da recién sin más páginas), después de "Más opciones". */}
      {page.nearby && <ResultSections sections={[page.nearby]} scores={props.scores} state={props.state} eagerCount={props.results.length === 0 ? EAGER_SEARCH_CARDS : undefined} />}

      {page.hasMore ? (
        <LoadMore key={pages} onReach={() => setPages((current) => current + 1)} />
      ) : (
        anyResults && <EndOfResults />
      )}

      {props.children}
    </div>
  );
};

export default ResultsView;
