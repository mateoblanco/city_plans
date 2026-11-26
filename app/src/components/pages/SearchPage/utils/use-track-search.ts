"use client";

import { useEffect } from "react";
import { setCurrentSearchQuery, takeSearchOrigin, track } from "@/lib/product-analytics/track";
import type { SearchSummary } from "./search-analytics";

// Cada búsqueda se cuenta una vez: el doble efecto de StrictMode (desarrollo) recibe el mismo objeto.
const counted = new WeakSet<SearchSummary>();

/** search_submitted (y search_no_results con cero) cuando se muestra la lista de una búsqueda nueva. */
export function useTrackSearch(summary: SearchSummary | undefined) {
  useEffect(() => {
    if (!summary || counted.has(summary)) return;
    counted.add(summary);
    setCurrentSearchQuery(summary.query);
    const props = { ...summary, origin: takeSearchOrigin() };
    track("search_submitted", props);
    if (summary.results_count === 0) track("search_no_results", props);
  }, [summary]);
}
