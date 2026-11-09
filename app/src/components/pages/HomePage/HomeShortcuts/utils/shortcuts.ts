import { INTENTS, type IntentId } from "@shared/intents.ts";
import { searchHref } from "@/components/pages/SearchPage/utils/search-href";

export type Shortcut = { text: string; href: string };

/** Las intenciones de la home, en este orden. El texto es el mismo del chip de la barra de /search. */
const SHORTCUT_INTENTS: IntentId[] = ["eat", "bars", "cafes", "desserts"];

/**
 * Accesos directos de la home: las intenciones van sin texto, con la intención estructurada (`intent=`, la misma que
 * elige el chip de la barra), así llegan activas con su fila de opciones; las dietas, con el filtro de la barra
 * (`f=diet:<key>`, activas en el select de Dieta).
 */
export const SHORTCUTS: Shortcut[] = [
  ...SHORTCUT_INTENTS.map((id) => ({ text: INTENTS[id].label.es, href: searchHref({ q: "", intent: id }) })),
  { text: "Vegetariano", href: searchHref({ q: "", f: "diet:vegetarian" }) },
  { text: "Vegano", href: searchHref({ q: "", f: "diet:vegan" }) },
  { text: "Sin TACC", href: searchHref({ q: "", f: "diet:glutenFree" }) },
];
