import type { StaticImageData } from "next/image";
import { INTENT_IDS, INTENTS, type IntentId } from "@shared/intents.ts";
import { MARKER_ICONS } from "@/components/pages/SearchPage/Results/Map/SearchMap/marker-icons";
import { barIntentHref, searchHref, type BarRef, type SearchUrl } from "@/components/pages/SearchPage/utils/search-href";

export type IntentTab = {
  /** null: "Todo" (sin intención). */
  id: IntentId | null;
  label: string;
  icon: StaticImageData | null;
  href: string;
  current: boolean;
};

export const ALL_TAB_LABEL = "Todo";

/**
 * Ícono de cada pestaña, de los de los marcadores del mapa. Comer: un plato servido (no la pizza, que se leería como
 * pizzería). "Todo" no lleva.
 */
export const TAB_ICONS: Record<IntentId, StaticImageData> = {
  eat: MARKER_ICONS.curry,
  bars: MARKER_ICONS.wine,
  cafes: MARKER_ICONS.coffee,
  desserts: MARKER_ICONS.cake,
};

/** El orden de las pestañas (después de "Todo"). */
const TAB_ORDER: IntentId[] = ["eat", "bars", "cafes", "desserts"];

/**
 * Las pestañas de intención arriba del buscador: Todo y cada intención, una sola activa (la de la búsqueda, venga de la
 * URL o del texto: bar.intent). Cambiar de pestaña es el mismo link que el chip de antes (barIntentHref: conserva texto,
 * filtros y ubicación); "Todo" saca la intención. La actual vuelve a la misma búsqueda; en la home, "Todo" es la home.
 * known null: todavía no se sabe la búsqueda (el HTML estático de /search), ninguna activa.
 */
export function intentTabs(state: SearchUrl, known: BarRef | null, home = false): IntentTab[] {
  // Sin bar (los parámetros todavía no llegaron): ninguna activa.
  const bar = known ?? urlBar(null);
  const active = known ? (bar.intent?.id ?? null) : undefined;
  const same = home ? "/" : searchHref(state);
  const all: IntentTab = {
    id: null,
    label: ALL_TAB_LABEL,
    icon: null,
    href: active === null ? same : barIntentHref(state, null, bar),
    current: active === null,
  };
  const order = [...TAB_ORDER, ...INTENT_IDS.filter((id) => !TAB_ORDER.includes(id))];
  return [
    all,
    ...order.map((id) => ({
      id,
      label: INTENTS[id].label.es,
      icon: TAB_ICONS[id],
      href: id === active ? same : barIntentHref(state, id, bar),
      current: id === active,
    })),
  ];
}

/**
 * Sin la respuesta de la búsqueda (mientras carga o si falló): la intención de la URL, como si se hubiera elegido en la
 * barra. Una intención que no existe cuenta como ninguna.
 */
export function urlBar(intent: string | null | undefined): BarRef {
  const id = INTENT_IDS.find((candidate) => candidate === intent) ?? null;
  return { intent: id ? { id, fromText: false } : null, textIntent: null, subs: [], extras: [] };
}
