import { normalizeBounds, zoneParam, type Bounds } from "@/lib/location";

/** Todo el estado de /search vive en la URL: texto, chips quitados, intención, filtros de la barra y ubicación. */
export type SearchUrl = {
  q: string;
  /** Chips del texto que se quitaron (kind:id separados por coma). */
  remove?: string | null;
  /** Intención elegida en la barra (bars) y sus sub-filtros (cocktails,live_music). */
  intent?: string | null;
  sub?: string | null;
  /** Filtros de la barra (open:today,diet:vegan,neighborhood:CORDON). */
  f?: string | null;
  /**
   * Dónde (`src/lib/location.ts`): `near` (cerca mío; nunca coordenadas: usa la ubicación de quien abre el link), `all`
   * (todo Montevideo) o una zona del mapa (`s,w,n,e`). Sin loc, la ubicación por defecto. Los barrios van en f.
   */
  loc?: string | null;
  debug?: boolean;
  /** false: profile=off (la misma búsqueda sin perfil); se conserva en los links, como debug. */
  profile?: boolean;
};

export type ChipRef = { kind: string; id: string; fromText?: boolean; fromFilter?: boolean };

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

/**
 * Clave del chip en `f`; null si ese chip no es un filtro de la barra. section es el "Ver todos" de un grupo, nearby el de
 * "Cerca de <barrio>" y tag, el de una fila de la home (Merienda).
 */
export function filterKey({ kind, id }: { kind: string; id: string }): string | null {
  if (kind === "openAt") return id === "today" ? "open:today" : null;
  return kind === "diet" || kind === "neighborhood" || kind === "price" || kind === "section" || kind === "nearby" || kind === "tag" ? `${kind}:${id}` : null;
}

/** URL de /search. `add` suma un chip a remove (lo que hacía antes quitar un chip). */
export function searchHref({ q, remove, intent, sub, f, loc, debug, profile, add }: SearchUrl & { add?: { kind: string; id: string } }): string {
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
  if (loc) params.set("loc", loc);
  if (debug) params.set("debug", "1");
  if (profile === false) params.set("profile", "off");
  const query = params.toString();
  return query ? `/search?${query}` : "/search";
}

const without = (raw: string | null | undefined, key: string) => list(raw).filter((item) => item !== key).join(",");

/**
 * Apagar un chip (o un toggle de la barra, que es lo mismo): lo de la barra se saca de f,
 * lo del texto se suma a remove, y "cerca mío" pasa a todo Montevideo (sin loc volvería a cerca mío, el valor por defecto).
 */
export function removeChipHref(state: SearchUrl, chip: ChipRef): string {
  if (chip.kind === "near") return searchHref({ ...state, loc: "all" });
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
 * Un select de la barra (barrios o precio): lo elegido reemplaza a lo anterior de ese kind y quita lo del texto que no
 * se eligió, así sacar después un chip no hace volver el del texto. Lo elegido deja de estar quitado.
 */
function replaceFilter(state: SearchUrl, kind: string, ids: string[], chips: ChipRef[]): SearchUrl {
  const keys = ids.map((id) => `${kind}:${id}`);
  const f = [...list(state.f).filter((item) => !item.startsWith(`${kind}:`)), ...keys];
  const fromText = chips.filter((chip) => chip.kind === kind && chip.fromText && !ids.includes(chip.id)).map((chip) => `${kind}:${chip.id}`);
  const remove = [...list(state.remove).filter((item) => !keys.includes(item)), ...fromText].join(",");
  return { ...state, f: f.join(","), remove };
}

/** Barrios del filtro "Dónde": reemplazan a la ubicación (cerca mío, todo Montevideo o la zona). [] = sin elección. */
export function setNeighborhoodsHref(state: SearchUrl, ids: string[], chips: ChipRef[]): string {
  return searchHref({ ...replaceFilter(state, "neighborhood", ids, chips), loc: null });
}

/**
 * "Cerca mío" o "Todo Montevideo" del filtro "Dónde": sacan los barrios de la barra y quitan los del texto (`remove`), así
 * lo elegido gana. chips: los de barrio de la búsqueda.
 */
export function setLocationHref(state: SearchUrl, loc: "near" | "all", chips: ChipRef[]): string {
  return searchHref({ ...replaceFilter(state, "neighborhood", [], chips), loc });
}

/**
 * "Buscar en esta zona": el área visible del mapa (redondeada hacia afuera a 3 decimales y recortada a Montevideo) reemplaza al barrio (de la barra o del texto)
 * y a cerca mío; todo lo demás (texto, intención, filtros) queda igual.
 */
export function zoneHref(state: SearchUrl, bounds: Bounds, chips: ChipRef[]): string {
  const zone = normalizeBounds(bounds);
  return searchHref({ ...replaceFilter(state, "neighborhood", [], chips), loc: zone ? zoneParam(zone) : null });
}

/** Precios del select de la barra. [] = "Cualquier precio". */
export function setPricesHref(state: SearchUrl, ids: string[], chips: ChipRef[]): string {
  return searchHref(replaceFilter(state, "price", ids, chips));
}

/** Dietas del select de la barra. [] = "Cualquier dieta". */
export function setDietsHref(state: SearchUrl, ids: string[], chips: ChipRef[]): string {
  return searchHref(replaceFilter(state, "diet", ids, chips));
}

/** Descuentos del panel de la barra (`itau.credit`, sin `discount:`). [] = sin filtro. No vienen del texto. */
export function setDiscountsHref(state: SearchUrl, ids: string[]): string {
  return searchHref(replaceFilter(state, "discount", ids, []));
}

/**
 * Lo del texto que vive en la fila de sub-filtros: al dejar la intención se suma a remove. Las categorías no:
 * "bar con amigos" sin Bares sigue siendo un bar (filtro obligatorio, extra "Bar ×" que se quita a mano).
 */
function textRow(bar: BarRef): string[] {
  return [
    ...bar.subs.filter((sub) => sub.active && sub.fromText).flatMap((sub) => sub.removeKeys),
    // Los momentos y el style ("con amigos", "de barrio") no son de la intención: siguen al cambiarla. El venue
    // ("En Mercado del Puerto") tampoco: es dónde.
    ...(bar.intent ? bar.extras.filter((chip) => chip.fromText !== false && chip.kind !== "prefer" && chip.kind !== "venue").map((chip) => `${chip.kind}:${chip.id}`) : []),
  ].filter((key) => !key.startsWith("category:"));
}

const intentKeys = (bar: BarRef) => (bar.textIntent ? [`intent:${bar.textIntent}`] : []);

/**
 * Elegir una intención (o null = "Todo"): limpia los sub-filtros de la anterior, vengan de la URL o del texto,
 * pero conserva barrio, abre hoy, dietas (f) y la ubicación (loc).
 */
export function intentHref(state: SearchUrl, id: string | null, bar: BarRef): string {
  return searchHref({ ...state, intent: id, sub: null, remove: [...list(state.remove), ...intentKeys(bar), ...textRow(bar)].join(",") });
}

/**
 * Un chip de intención de la barra: combina con el texto. Elegir o cambiar de intención conserva el texto entero (los
 * extras del texto no se ven, así que no se suman a remove); apagar una elegida en la barra vuelve a la búsqueda sólo
 * con el texto (si el texto elige una intención por sí mismo, reaparece). Apagar una que vino del texto, como intentHref.
 */
export function barIntentHref(state: SearchUrl, id: string | null, bar: BarRef): string {
  if (id === null && bar.intent && !bar.intent.fromText) return searchHref({ ...state, intent: null, sub: null });
  return intentHref(state, id, { ...bar, extras: [] });
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

/** "Ver todos" de un grupo: la misma búsqueda con la regla del grupo como filtro (reemplaza otra sección). */
export function sectionHref(state: SearchUrl, id: string): string {
  const f = list(state.f).filter((item) => !item.startsWith("section:"));
  return searchHref({ ...state, f: [...f, `section:${id}`].join(",") });
}

/** "Ver todos" de "Cerca de <barrio>": la misma búsqueda con sólo los lugares cercanos (`f=nearby:1`). */
export function nearbyHref(state: SearchUrl): string {
  const f = list(state.f).filter((item) => !item.startsWith("nearby:"));
  return searchHref({ ...state, f: [...f, "nearby:1"].join(",") });
}

/** La misma búsqueda contra /api/search/widen (la invitación a ampliar del final de la lista), sin debug. */
export function widenUrl(state: SearchUrl): string {
  return `/api/search/widen${searchHref({ ...state, debug: false }).slice("/search".length)}`;
}
