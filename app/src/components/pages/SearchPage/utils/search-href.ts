import { roundCoord } from "@/server/search/coords";

/** Todo el estado de /search vive en la URL: texto, chips quitados, intención, filtros de la barra y ubicación. */
export type SearchUrl = {
  q: string;
  /** Chips del texto que se quitaron (kind:id separados por coma). */
  remove?: string | null;
  /** Intención elegida en la barra (bars) y sus sub-filtros (cocktails,live_music). */
  intent?: string | null;
  sub?: string | null;
  /** Filtros de la barra (open:now,diet:vegan,neighborhood:CORDON). */
  f?: string | null;
  /** Cerca mío: lat,lng redondeados a 3 decimales. */
  near?: string | null;
  debug?: boolean;
};

type ChipRef = { kind: string; id: string; fromText?: boolean; fromFilter?: boolean };

/** Lo que la barra sabe de la intención (IntentBar del server, sin labels). */
export type BarRef = {
  intent: { id: string; fromText: boolean } | null;
  textIntent: string | null;
  subs: { id: string; active: boolean; fromText: boolean; removeKeys: string[] }[];
  extras: ChipRef[];
};

const list = (raw: string | null | undefined) =>
  (raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** Clave del chip en `f`; null si ese chip no es un filtro de la barra. */
export function filterKey({ kind, id }: { kind: string; id: string }): string | null {
  if (kind === "openAt") return id === "now" ? "open:now" : null;
  return kind === "diet" || kind === "neighborhood" ? `${kind}:${id}` : null;
}

/** URL de /search. `add` suma un chip a remove (lo que hacía antes quitar un chip). */
export function searchHref({ q, remove, intent, sub, f, near, debug, add }: SearchUrl & { add?: { kind: string; id: string } }): string {
  const removals = list(remove);
  if (add) removals.push(`${add.kind}:${add.id}`);

  const params = new URLSearchParams();
  if (q) params.set("q", q);
  const unique = [...new Set(removals)];
  if (unique.length) params.set("remove", unique.join(","));
  if (intent) {
    params.set("intent", intent);
    const subs = [...new Set(list(sub))];
    if (subs.length) params.set("sub", subs.join(","));
  }
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

/**
 * Lo del texto que vive en la fila de sub-filtros: al dejar la intención se suma a remove. Las categorías no:
 * "bar con amigos" sin Bares sigue siendo un bar (filtro obligatorio, extra "Bar ×" que se quita a mano).
 */
function textRow(bar: BarRef): string[] {
  return [
    ...bar.subs.filter((sub) => sub.active && sub.fromText).flatMap((sub) => sub.removeKeys),
    ...(bar.intent ? bar.extras.filter((chip) => chip.fromText !== false).map((chip) => `${chip.kind}:${chip.id}`) : []),
  ].filter((key) => !key.startsWith("category:"));
}

const intentKeys = (bar: BarRef) => (bar.textIntent ? [`intent:${bar.textIntent}`] : []);

/**
 * Elegir una intención (o null = "Todo"): limpia los sub-filtros de la anterior, vengan de la URL o del texto,
 * pero conserva barrio, abierto ahora, dietas (f) y cerca mío.
 */
export function intentHref(state: SearchUrl, id: string | null, bar: BarRef): string {
  return searchHref({ ...state, intent: id, sub: null, remove: [...list(state.remove), ...intentKeys(bar), ...textRow(bar)].join(",") });
}

/**
 * Prender o apagar un sub-filtro. Apagar uno del texto suma lo que lo activó a remove. La intención queda fija
 * en la URL: si no, quitar lo del texto podría hacer que el texto deje de elegirla.
 */
export function subHref(state: SearchUrl, id: string, bar: BarRef): string {
  const current = bar.subs.find((sub) => sub.id === id);
  const intent = bar.intent?.id ?? state.intent ?? null;
  const subs = list(state.sub).filter((item) => item !== id);
  const remove = list(state.remove);
  if (!current?.active) subs.push(id);
  else if (current.fromText) remove.push(...current.removeKeys);
  return searchHref({ ...state, intent, sub: subs.join(","), remove: remove.join(",") });
}

/** Quitar un extra ("Pizza ×"): el remove de siempre, con la intención fija en la URL. */
export function extraHref(state: SearchUrl, chip: ChipRef, bar: BarRef): string {
  return removeChipHref({ ...state, intent: bar.intent?.id ?? state.intent ?? null }, chip);
}
