/**
 * Lo que dice el contador de "Cerca de <barrio>": label es el barrio ("Palermo"), count los cercanos (todos, no sólo los
 * del grupo) y only, el "Ver todos" del grupo (los resultados son los cercanos).
 */
export type NearbyCount = { label: string; count: number; only: boolean };

const places = (count: number) => (count === 1 ? "1 lugar" : `${count.toLocaleString("es-UY")} lugares`);

/**
 * "1 lugar", "1.234 lugares"; mientras busca (null), "Buscando…". El título del panel de mobile (ResultsSheet). Con
 * "Cerca de": "18 lugares en Palermo · 6 cerca", "6 cerca de Palermo" (nada en el barrio) o, en su "Ver todos", "12
 * lugares cerca de Palermo".
 */
export function resultsCountLabel(count: number | null, nearby: NearbyCount | null = null): string {
  if (count === null) return "Buscando…";
  if (nearby?.only) return `${places(count)} cerca de ${nearby.label}`;
  if (!nearby || nearby.count === 0) return places(count);
  if (count === 0) return `${nearby.count.toLocaleString("es-UY")} cerca de ${nearby.label}`;
  return `${places(count)} en ${nearby.label} · ${nearby.count.toLocaleString("es-UY")} cerca`;
}

/** Lo que anuncia la región viva de /search (ResultsAnnouncer): como el título, pero sin resultados lo dice. */
export function resultsAnnouncement(count: number | null, nearby: NearbyCount | null = null): string {
  if (count === 0 && nearby && !nearby.only && nearby.count > 0) return `No encontramos en ${nearby.label} · ${nearby.count.toLocaleString("es-UY")} cerca`;
  return count === 0 ? "No encontramos lugares" : resultsCountLabel(count, nearby);
}
