import Link from "next/link";
import type { CardDebug } from "@/components/PlaceCard/PlaceCard";
import { searchPlaces, type SearchResponse, type SearchResult } from "@/server/search";
import DebugPanel from "./DebugPanel";
import FilterBar from "./FilterBar";
import MapSync from "./MapSync";
import ResultCard from "./ResultCard";
import { searchHref, type SearchUrl } from "./search-href";
import styles from "./SearchPage.module.scss";

type SearchPageProps = {
  query: string;
  remove: string | null;
  intent: string | null;
  sub: string | null;
  filters: string | null;
  near: string | null;
  debug: boolean;
};

const Places = ({ places, scores }: { places: SearchResult[]; scores: Map<string, CardDebug> | null }) => (
  <div className={styles.grid}>
    {places.map((place) => (
      <ResultCard key={place.id} place={place} debug={scores?.get(place.id)} />
    ))}
  </div>
);

/** Con debug: puntajes de cada resultado y su porcentaje respecto del primero que se muestra. */
function cardScores(response: SearchResponse): Map<string, CardDebug> | null {
  if (!response.debug) return null;
  const top = response.debug.results.find((result) => result.id === response.results[0]?.id)?.score ?? 0;
  return new Map(
    response.debug.results.map(({ id, score, baseScore, multiplier, pinned }) => [
      id,
      { score, baseScore, multiplier, pinned, percent: top > 0 ? score / top : null },
    ]),
  );
}

const SearchPage = async ({ query, remove, intent, sub, filters, near, debug }: SearchPageProps) => {
  const state: SearchUrl = { q: query, remove, intent, sub, f: filters, near, debug };
  let response: SearchResponse;
  try {
    response = await searchPlaces(query, { remove, filters, near, intent, sub, debug });
  } catch (error) {
    console.error("Falló la búsqueda", error);
    return (
      <div className={styles.empty} role="alert">
        <p>No pudimos completar la búsqueda.</p>
        <Link href={searchHref(state)} prefetch={false}>
          Reintentar
        </Link>
        <div className={styles.map} />
      </div>
    );
  }

  // La barra es el único lugar donde se ven y cambian los filtros (los detecte el texto o no): intención,
  // sub-filtros y lo que pidió el texto sin botón propio (platos, tags). Preferencias, vibe, precio, exclusiones
  // y día/hora siguen ordenando o filtrando, pero se cambian editando el texto.
  const { interpreted, relaxed, results, needsLocation } = response;
  const has = results.filter((result) => result.matchLevel === "has");
  const maybe = results.filter((result) => result.matchLevel === "maybe");
  const dishes = interpreted.chips.filter((chip) => chip.kind === "dish").map((chip) => chip.label);
  const scores = cardScores(response);
  const notices = relaxed.map((notice) => notice.message);

  const mapPlaces = results.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }));

  return (
    <MapSync places={mapPlaces} userLocation={response.near}>
    <div className={styles.results}>
      <FilterBar state={state} chips={interpreted.chips} bar={response.bar} needsLocation={needsLocation} />

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
      ) : (
        <>
          {has.length > 0 && <Places places={has} scores={scores} />}
          {maybe.length > 0 && (
            <section className={styles.results}>
              <h2 className={styles.sectionTitle}>Puede que tengan {dishes.length ? dishes.join(" o ") : "lo que buscás"}</h2>
              <Places places={maybe} scores={scores} />
            </section>
          )}
        </>
      )}

      {response.debug && <DebugPanel debug={response.debug} chips={interpreted.chips} bar={response.bar} />}
    </div>
    </MapSync>
  );
};

export default SearchPage;
