import Link from "next/link";
import { searchPlaces, type SearchResponse } from "@/server/search";
import DebugPanel from "../DebugPanel/DebugPanel";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import ResultsView from "../ResultsView/ResultsView";
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
      </div>
    );
  }

  // La barra de filtros se renderiza aparte (SearchFilters), con la misma búsqueda deduplicada.
  const { interpreted, relaxed, results, sections } = response;
  return (
    <ResultsView
      results={results}
      sections={sections}
      notices={relaxed.map((notice) => notice.message)}
      scores={cardScores(response)}
      near={response.near}
      state={toSearchUrl(props.params)}
    >
      {response.debug && <DebugPanel debug={response.debug} chips={interpreted.chips} bar={response.bar} response={response} />}
    </ResultsView>
  );
};

export default SearchResults;
