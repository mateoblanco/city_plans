import Link from "next/link";
import { searchPlaces, type SearchResponse } from "@/server/search";
import DebugPanel from "../DebugPanel/DebugPanel";
import EmptyMap from "./EmptyMap";
import type { CardDebug } from "../PlaceCard/PlaceCard";
import ResultsView from "../ResultsView/ResultsView";
import LocationGate from "../LocationGate/LocationGate";
import styles from "./SearchResults.module.scss";
import { searchHref } from "../../utils/search-href";
import { toSearchOptions, toSearchUrl, type Params } from "../../utils/search-params";
import { searchHeading, searchTitleInput } from "../../utils/search-title";

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
        <EmptyMap />
        <p>No pudimos completar la búsqueda.</p>
        <Link href={searchHref(toSearchUrl(props.params))} prefetch={false}>
          Reintentar
        </Link>
      </div>
    );
  }

  // La barra de filtros se renderiza aparte (SearchFilters), con la misma búsqueda deduplicada.
  const { interpreted, relaxed, results, sections, forYou, nearby, nearbyOnly, location } = response;
  const neighborhoodChips = interpreted.chips.filter((chip) => chip.kind === "neighborhood");
  // Sin ubicación todavía: se pide y, con la respuesta, se vuelve a buscar (no hay resultados mientras tanto).
  if (location.kind === "ask") {
    return (
      <>
        <h1 className={styles.visuallyHidden}>{searchHeading(searchTitleInput(props.params.query, response))}</h1>
        <LocationGate state={toSearchUrl(props.params)} chips={neighborhoodChips} explicit={location.explicit} />
      </>
    );
  }
  return (
    <>
      {/* h1 para lectores de pantalla y buscadores (el título del <head> es el mismo): no cambia el diseño. */}
      <h1 className={styles.visuallyHidden}>{searchHeading(searchTitleInput(props.params.query, response))}</h1>
      <ResultsView
        results={results}
        sections={sections}
        forYou={forYou}
        nearby={nearby}
        nearbyOnly={nearbyOnly}
        notices={relaxed.map((notice) => notice.message)}
        scores={cardScores(response)}
        near={response.near}
        zone={location.kind === "zone" ? location.bounds : null}
        state={toSearchUrl(props.params)}
        neighborhoodChips={neighborhoodChips}
      >
        {response.debug && <DebugPanel debug={response.debug} chips={interpreted.chips} bar={response.bar} response={response} />}
      </ResultsView>
    </>
  );
};

export default SearchResults;
