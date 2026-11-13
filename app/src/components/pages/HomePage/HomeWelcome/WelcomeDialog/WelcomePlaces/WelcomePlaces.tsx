"use client";

import { Input } from "@base-ui/react/input";
import { useEffect, useId, useState } from "react";
import Button from "@/components/base/Button/Button";
import type { WelcomePlace } from "@/server/welcome";
import { choiceCount, toggleChoice, WELCOME_MAX_PLACES } from "../../utils/welcome";
import WelcomePlaceCard from "./WelcomePlaceCard/WelcomePlaceCard";
import styles from "./WelcomePlaces.module.scss";

/** Espera después de la última tecla antes de buscar. */
const SEARCH_DELAY_MS = 250;
/** Letras mínimas para buscar (como el servidor). */
const SEARCH_MIN = 2;

type Props = {
  selected: string[];
  onChange: (ids: string[]) => void;
};

type Loaded = { key: string; places: WelcomePlace[] | null };

async function fetchPlaces(url: string, signal: AbortSignal): Promise<WelcomePlace[]> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return ((await response.json()) as { places: WelcomePlace[] }).places;
}

/**
 * Paso "Elegí hasta 3 lugares": un buscador sobre los publicados (sin tildes ni mayúsculas, parcial) y, sin búsqueda,
 * una grilla de 20 lugares conocidos y variados. Cada card es un checkbox; al llegar a 3 no se marcan más. Lo marcado
 * se conserva al buscar.
 */
const WelcomePlaces = (props: Props) => {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [grid, setGrid] = useState<Loaded | null>(null);
  const [results, setResults] = useState<Loaded | null>(null);
  const term = query.trim();
  const searching = term.length >= SEARCH_MIN;

  useEffect(() => {
    const controller = new AbortController();
    const key = String(attempt);
    fetchPlaces("/api/welcome/places", controller.signal)
      .then((places) => setGrid({ key, places }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error("No se pudo cargar la grilla de la bienvenida", error);
          setGrid({ key, places: null });
        }
      });
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const key = `${attempt}:${term}`;
    const timer = setTimeout(() => {
      fetchPlaces(`/api/welcome/search?q=${encodeURIComponent(term)}`, controller.signal)
        .then((places) => setResults({ key, places }))
        .catch(() => {
          if (!controller.signal.aborted) setResults({ key, places: null });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searching, term, attempt]);

  // Lo que se ve: los resultados de esta búsqueda o la grilla; undefined mientras carga.
  const current = searching ? (results?.key === `${attempt}:${term}` ? results.places : undefined) : grid?.key === String(attempt) ? grid.places : undefined;
  const full = props.selected.length >= WELCOME_MAX_PLACES;

  return (
    <div className={styles.places}>
      <div className={styles.search}>
        <label htmlFor={inputId} className={styles.label}>
          Buscá un lugar
        </label>
        <Input id={inputId} type="search" className={styles.input} value={query} onValueChange={setQuery} placeholder="Nombre del lugar" autoComplete="off" />
      </div>
      <p className={styles.count} aria-live="polite">
        {choiceCount(props.selected)}
      </p>
      {current === undefined && (
        <div className={styles.grid} aria-hidden="true">
          <div className={styles.skeleton} />
        </div>
      )}
      {current === null && (
        <div className={styles.error} role="alert">
          <p>No pudimos cargar los lugares.</p>
          <Button type="button" variant="secondary" size="sm" label="Reintentar" onClick={() => setAttempt((value) => value + 1)} />
        </div>
      )}
      {current && current.length === 0 && <p className={styles.empty}>No encontramos lugares con ese nombre.</p>}
      {current && current.length > 0 && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.visuallyHidden}>{searching ? `Resultados para "${term}"` : "Lugares conocidos"}</legend>
          <ul className={styles.grid}>
            {current.map((place) => {
              const checked = props.selected.includes(place.id);
              return (
                <li key={place.id}>
                  <WelcomePlaceCard place={place} checked={checked} disabled={full && !checked} onToggle={() => props.onChange(toggleChoice(props.selected, place.id))} />
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
    </div>
  );
};

export default WelcomePlaces;
