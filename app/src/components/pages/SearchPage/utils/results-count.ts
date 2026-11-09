/** "1 lugar", "1.234 lugares"; mientras busca (null), "Buscando…". El título del panel de mobile (ResultsSheet). */
export const resultsCountLabel = (count: number | null) =>
  count === null ? "Buscando…" : count === 1 ? "1 lugar" : `${count.toLocaleString("es-UY")} lugares`;

/** Lo que anuncia la región viva de /search (ResultsAnnouncer): como el título, pero sin resultados lo dice. */
export const resultsAnnouncement = (count: number | null) => (count === 0 ? "No encontramos lugares" : resultsCountLabel(count));
