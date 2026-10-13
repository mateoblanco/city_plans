type SearchHrefParams = {
  q: string;
  /** Lo que ya estaba en remove (kind:id separados por coma). */
  remove?: string | null;
  /** Chip a sumar a remove. */
  add?: { kind: string; id: string };
  debug?: boolean;
};

/** URL de /search: todo el estado de la búsqueda vive en q, remove y debug. */
export function searchHref({ q, remove, add, debug }: SearchHrefParams): string {
  const removals = (remove ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (add) removals.push(`${add.kind}:${add.id}`);

  const params = new URLSearchParams({ q });
  const unique = [...new Set(removals)];
  if (unique.length) params.set("remove", unique.join(","));
  if (debug) params.set("debug", "1");
  return `/search?${params.toString()}`;
}
