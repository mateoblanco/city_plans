import Link from "next/link";
import { searchPlaces, type Chip, type SearchResponse, type SearchResult } from "@/server/search";
import DebugPanel from "./DebugPanel";
import MapSync from "./MapSync";
import ResultCard from "./ResultCard";
import { searchHref } from "./search-href";
import styles from "./SearchPage.module.scss";

/** "Quitar: excepto restaurantes", "Quitar: sin TACC"; los nombres propios (barrios, lugares) quedan como están. */
const removeText = ({ kind, label }: Chip) =>
  `Quitar: ${kind === "diet" || kind === "exclude" ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label}`;

type SearchPageProps = {
  query: string;
  remove: string | null;
  debug: boolean;
};

const Places = ({ places }: { places: SearchResult[] }) => (
  <div className={styles.grid}>
    {places.map((place) => (
      <ResultCard key={place.id} place={place} />
    ))}
  </div>
);

const SearchPage = async ({ query, remove, debug }: SearchPageProps) => {
  let response: SearchResponse;
  try {
    response = await searchPlaces(query, { remove, debug });
  } catch (error) {
    console.error("Falló la búsqueda", error);
    return (
      <div className={styles.empty} role="alert">
        <p>No pudimos completar la búsqueda.</p>
        <Link href={searchHref({ q: query, remove, debug })} prefetch={false}>
          Reintentar
        </Link>
        <div className={styles.map} />
      </div>
    );
  }

  const { interpreted, relaxed, results, suggestedRemovals, needsLocation } = response;
  const removeHref = (chip: { kind: string; id: string }) => searchHref({ q: query, remove, add: chip, debug });
  const has = results.filter((result) => result.matchLevel === "has");
  const maybe = results.filter((result) => result.matchLevel === "maybe");
  const dishes = interpreted.chips.filter((chip) => chip.kind === "dish").map((chip) => chip.label);
  const notices = [...relaxed.map((notice) => notice.message), ...(needsLocation ? ["Pronto vas a poder buscar cerca tuyo."] : [])];

  const mapPlaces = results.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }));

  return (
    <MapSync places={mapPlaces}>
    <div className={styles.results}>
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
          {has.length > 0 && <Places places={has} />}
          {maybe.length > 0 && (
            <section className={styles.results}>
              <h2 className={styles.sectionTitle}>Puede que tengan {dishes.length ? dishes.join(" o ") : "lo que buscás"}</h2>
              <Places places={maybe} />
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
