import Link from "next/link";
import { searchPlaces, type SearchResponse } from "@/server/search";
import DebugPanel from "../DebugPanel/DebugPanel";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import PlacesGrid from "../PlacesGrid/PlacesGrid";
import ResultSections from "../ResultSections/ResultSections";
import MapSync from "../Map/MapSync/MapSync";
import MapColumn from "../Map/MapColumn/MapColumn";
import styles from "./SearchResults.module.scss";
import { searchHref } from "../../utils/search-href";
import { toSearchOptions, toSearchUrl, type Params } from "../../utils/search-params";

/** Con debug: puntajes de cada resultado, su similitud y por qué pasó el corte por relevancia. */
function cardScores(response: SearchResponse): Map<string, CardDebug> | null {
  if (!response.debug) return null;
  return new Map(
    response.debug.results.map(({ id, score, baseScore, multiplier, pinned, similarity, relevance }) => [
      id,
      { score, baseScore, multiplier, pinned, similarity, keptBy: "kept" in relevance ? relevance.kept : null },
    ]),
  );
}

type Props = {
  params: Params;
};

const SearchResults = async (props: Props) => {
  let response: SearchResponse;
  try {
    response = await searchPlaces(props.params.query, toSearchOptions(props.params));
  } catch (error) {
    console.error("Falló la búsqueda", error);
    return (
      <div className={styles.empty} role="alert">
        <p>No pudimos completar la búsqueda.</p>
        <Link href={searchHref(toSearchUrl(props.params))} prefetch={false}>
          Reintentar
        </Link>
        {/* <MapColumn /> */}
      </div>
    );
  }

  // La barra de filtros se renderiza aparte (SearchFilters), con la misma búsqueda deduplicada.
  const { interpreted, relaxed, results } = response;
  const scores = cardScores(response);
  const notices = relaxed.map((notice) => notice.message);

  const mapPlaces = results.map(({ id, name, lat, lng, iconCategory }) => ({ id, name, lat, lng, iconCategory }));

  return (
    <MapSync places={mapPlaces} userLocation={response.near}>
      <div className={styles.results}>
        {notices.length > 0 && (
          <div className={styles.notices}>
            {notices.map((message) => (
              <p key={message} className={styles.notice} role="status">
                {message}
              </p>
            ))}
          </div>
        )}

        {results.length === 0 ? (
          <div className={styles.empty}>
            {relaxed.length === 0 && <p>No encontramos lugares para esta búsqueda.</p>}
          </div>
        ) : response.sections ? (
          // Búsqueda amplia: secciones con título. El mapa sigue mostrando todos los resultados juntos.
          <ResultSections sections={response.sections} results={results} scores={scores} />
        ) : (
          // Una sola grilla: los que tienen el plato ya vienen primero, y los "maybe" lo dicen en la card
          // ("Puede que tengan pizza", en sus motivos).
          <PlacesGrid places={results} scores={scores} />
        )}

        {response.debug && <DebugPanel debug={response.debug} chips={interpreted.chips} bar={response.bar} response={response} />}
      </div>
    </MapSync>
  );
};

export default SearchResults;
