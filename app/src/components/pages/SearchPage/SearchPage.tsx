import Link from "next/link";
import type { CardDebug } from "@/components/PlaceCard/PlaceCard";
import { searchPlaces, type Chip, type SearchResponse, type SearchResult } from "@/server/search";
import DebugPanel from "./DebugPanel";
import FilterBar from "./FilterBar";
import MapSync from "./MapSync";
import ResultCard from "./ResultCard";
import { removeChipHref, searchHref, type SearchUrl } from "./search-href";
import styles from "./SearchPage.module.scss";

/** "Quitar: excepto restaurantes", "Quitar: sin TACC"; los nombres propios (barrios, lugares) quedan como están. */
const removeText = ({ kind, label }: Chip) =>
  `Quitar: ${kind === "diet" || kind === "exclude" ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}`;

type SearchPageProps = {
  query: string;
  remove: string | null;
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

const SearchPage = async ({ query, remove, filters, near, debug }: SearchPageProps) => {
  const state: SearchUrl = { q: query, remove, f: filters, near, debug };
  let response: SearchResponse;
  try {
    response = await searchPlaces(query, { remove, filters, near, debug });
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

  const { interpreted, relaxed, results, suggestedRemovals, needsLocation } = response;
  const removeHref = (chip: Chip) => removeChipHref(state, chip);
  const has = results.filter((result) => result.matchLevel === "has");
  const maybe = results.filter((result) => result.matchLevel === "maybe");
  const dishes = interpreted.chips.filter((chip) => chip.kind === "dish").map((chip) => chip.label);
  const scores = cardScores(response);
  const notices = relaxed.map((notice) => notice.message);

  const mapPlaces = results.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }));

  return (
    <MapSync places={mapPlaces} userLocation={response.near}>
    <div className={styles.results}>
      <FilterBar state={state} chips={interpreted.chips} needsLocation={needsLocation} />

      {interpreted.chips.length > 0 && (
        <ul className={styles.chips} aria-label="Lo que entendimos">
          {interpreted.chips.map((chip) => (
            <li key={`${chip.kind}:${chip.id}`}>
              <Link className={styles.chip} href={removeHref(chip)} aria-label={removeText(chip)}>
                {chip.label} ×
              </Link>
            </li>
          ))}
        </ul>
      )}

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
          {suggestedRemovals.length > 0 && (
            <ul className={styles.chips}>
              {suggestedRemovals.map((chip) => (
                <li key={`${chip.kind}:${chip.id}`}>
                  <Link className={styles.chip} href={removeHref(chip)}>
                    {removeText(chip)}
                  </Link>
                </li>
              ))}
            </ul>
          )}
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

      {response.debug && <DebugPanel debug={response.debug} />}
    </div>
    </MapSync>
  );
};

export default SearchPage;
