"use client";

import { useRouter } from "next/navigation";
import { use, useEffect, useRef } from "react";
import ResultsSkeleton from "../ResultsSkeleton/ResultsSkeleton";
import { LOCATING_LABEL } from "../../utils/results-count";
import { setLocationHref, type ChipRef, type SearchUrl } from "../../utils/search-href";
import { SearchMapContext } from "../../utils/use-search-map";
import { requestLocation } from "../../utils/use-location";

type Props = {
  state: SearchUrl;
  /** Los chips de barrio de la búsqueda, para armar "Todo Montevideo" si falla. */
  chips: ChipRef[];
  /** La pidió la persona ("Cerca mío" elegido o escrito): si falla, todo Montevideo elegido (si no, se pediría de nuevo). */
  explicit: boolean;
};

/**
 * La búsqueda necesita la ubicación (location.kind = 'ask'): el skeleton con "Buscando cerca tuyo…" mientras el
 * navegador pregunta. Nunca muestra resultados de todo Montevideo mientras tanto. Con la respuesta queda la cookie `loc`
 * (la ubicación redondeada, `denied` o `skip`) y se vuelve a pedir la misma búsqueda: cerca mío o, si la negó, todo
 * Montevideo (y no se le vuelve a pedir sola).
 */
const LocationGate = (props: Props) => {
  const router = useRouter();
  const store = use(SearchMapContext);
  const asked = useRef(false);
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });

  useEffect(() => {
    store.setLocating(true);
    return () => store.setLocating(false);
  }, [store]);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void requestLocation().then((result) => {
      const { explicit, state, chips } = latest.current;
      // replace: volver atrás no tiene que caer en la página que pide la ubicación.
      if (result !== "found" && explicit) router.replace(setLocationHref(state, "all", chips));
      else router.refresh();
    });
  }, [router]);

  return <ResultsSkeleton label={LOCATING_LABEL} />;
};

export default LocationGate;
