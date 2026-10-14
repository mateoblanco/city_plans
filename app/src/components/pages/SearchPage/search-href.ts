import { roundCoord } from "@/server/search/coords";

/** Todo el estado de /search vive en la URL: texto, chips quitados, filtros de la barra y ubicación. */
export type SearchUrl = {
  q: string;
  /** Chips del texto que se quitaron (kind:id separados por coma). */
  remove?: string | null;
  /** Filtros de la barra (open:now,category:cafe,diet:vegan,neighborhood:CORDON). */
  f?: string | null;
  /** Cerca mío: lat,lng redondeados a 3 decimales. */
  near?: string | null;
  debug?: boolean;
};

type ChipRef = { kind: string; id: string; fromText?: boolean; fromFilter?: boolean };

const list = (raw: string | null | undefined) =>
  (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** Clave del chip en `f`; null si ese chip no es un filtro de la barra. */
export function filterKey({ kind, id }: { kind: string; id: string }): string | null {
  if (kind === "openAt") return id === "now" ? "open:now" : null;
  return kind === "category" || kind === "diet" || kind === "neighborhood" ? `${kind}:${id}` : null;
}

/** URL de /search. `add` suma un chip a remove (lo que hacía antes quitar un chip). */
export function searchHref({ q, remove, f, near, debug, add }: SearchUrl & { add?: { kind: string; id: string } }): string {
  const removals = list(remove);
  if (add) removals.push(`${add.kind}:${add.id}`);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const unique = [...new Set(removals)];
  if (unique.length) params.set("remove", unique.join(","));
  const filters = [...new Set(list(f))];
  if (filters.length) params.set("f", filters.join(","));
  if (near) params.set("near", near);
  if (debug) params.set("debug", "1");
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

const without = (raw: string | null | undefined, key: string) => list(raw).filter((item) => item !== key).join(",");

/**
 * Apagar un chip (o un toggle de la barra, que es lo mismo): lo de la barra se saca de f,
 * lo del texto se suma a remove, y "cerca mío" saca la ubicación.
 */
export function removeChipHref(state: SearchUrl, chip: ChipRef): string {
  if (chip.kind === "near") return searchHref({ ...state, near: null });
  const key = filterKey(chip);
  const f = chip.fromFilter && key ? without(state.f, key) : state.f;
  const fromText = chip.fromText ?? !chip.fromFilter;
  return searchHref({ ...state, f, add: fromText ? chip : undefined });
}

/** Prender un filtro de la barra: va a f y, si ese chip se había quitado del texto, deja de estar quitado. */
export function addFilterHref(state: SearchUrl, chip: { kind: string; id: string }): string {
  const key = filterKey(chip);
  if (!key) return searchHref(state);
  return searchHref({ ...state, f: [...list(state.f), key].join(","), remove: without(state.remove, `${chip.kind}:${chip.id}`) });
}

/**
 * Barrio de la barra (uno solo): reemplaza el anterior y quita los barrios del texto, así sacar después
 * el chip no hace volver el del texto. null = "Todos".
 */
export function setNeighborhoodHref(state: SearchUrl, id: string | null, chips: ChipRef[]): string {
  const f = list(state.f).filter((item) => !item.startsWith("neighborhood:"));
  const fromText = chips
    .filter((chip) => chip.kind === "neighborhood" && chip.fromText && chip.id !== id)
    .map((chip) => `neighborhood:${chip.id}`);
  const remove = [...list(id ? without(state.remove, `neighborhood:${id}`) : state.remove), ...fromText].join(",");
  return searchHref({ ...state, f: id ? [...f, `neighborhood:${id}`].join(",") : f.join(","), remove });
}

/** Cerca mío: las coordenadas van redondeadas a 3 decimales (unos 100 m). */
export function nearHref(state: SearchUrl, lat: number, lng: number): string {
  return searchHref({ ...state, near: `${roundCoord(lat)},${roundCoord(lng)}` });
}
