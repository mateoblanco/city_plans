import { INTENTS, type IntentId } from "@shared/intents.ts";
import type { Chip, SearchResponse } from "@/server/search";

/**
 * Título y h1 de /search, armados con lo que entendió la búsqueda (sin modelo extra: es la misma búsqueda de la página).
 * "Bares para tomar algo en Montevideo", "Almorzar en Ciudad Vieja", "Cafés en Pocitos". /search no se indexa: el
 * título es para la pestaña, el historial y los lectores de pantalla.
 */
export type SearchTitleInput = {
  query: string;
  intent: IntentId | null;
  /** Los chips de la búsqueda: de acá salen los barrios (del texto o de la barra). */
  chips: Pick<Chip, "kind" | "label" | "fromText" | "fromFilter">[];
  /** Opciones de la intención elegidas en la barra ("Tragos"), en su orden. Las del texto no: ya están en la consulta. */
  subs?: string[];
  /** El "Ver todos" de "Cerca de <barrio>": el barrio ("Palermo"). El título dice "… cerca de Palermo". */
  nearby?: string | null;
};

const SITE = "Salimos";
const CITY = "Montevideo";
const MAX_QUERY = 60;

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase("es") + text.slice(1);

const clip = (text: string) => (text.length <= MAX_QUERY ? text : `${text.slice(0, MAX_QUERY - 1).replace(/\s+\S*$/, "")}…`);

/** ¿La consulta arranca con un verbo de la intención ("tomar algo", "comer")? Entonces se lee "Bares para tomar algo". */
const startsWithVerb = (query: string, intent: IntentId) => {
  const text = plain(query);
  return INTENTS[intent].verbs.es.some((verb) => {
    const plainVerb = plain(verb);
    return text === plainVerb || text.startsWith(`${plainVerb} `);
  });
};

/** El lugar: el barrio de la barra (el del texto ya está en la consulta) o, sin barrio, Montevideo. */
function placeSuffix(chips: SearchTitleInput["chips"]): string {
  const neighborhoods = chips.filter((chip) => chip.kind === "neighborhood");
  if (neighborhoods.length === 0) return ` en ${CITY}`;
  if (neighborhoods.some((chip) => chip.fromText)) return "";
  return ` en ${neighborhoods.map((chip) => chip.label).join(" y ")}`;
}

/** "Tragos", "Tragos y vinos", "Tragos, vinos y cerveza": la primera con mayúscula, como en la barra. */
function subList(labels: string[]): string {
  const [first, ...rest] = labels.map((label, index) => (index === 0 ? label : label.charAt(0).toLocaleLowerCase("es") + label.slice(1)));
  if (rest.length === 0) return first;
  return `${[first, ...rest.slice(0, -1)].join(", ")} y ${rest[rest.length - 1]}`;
}

/** El h1 (sin el nombre del sitio). */
export function searchHeading(input: SearchTitleInput): string {
  const query = clip(input.query.replace(/\s+/g, " ").trim());
  const noun = input.intent ? capitalize(INTENTS[input.intent].noun.es) : null;
  let subject: string;
  const verb = query !== "" && input.intent !== null && startsWithVerb(query, input.intent);
  // "comer" con Comer: "Lugares para comer" ya lo dice. "tomar algo" con Bares: "Bares para tomar algo". Un sustantivo de
  // varias palabras ("lugares para comer") no se combina: "Lugares para comer para salir a comer" se lee mal.
  if (verb && noun && plain(noun).endsWith(plain(query))) subject = noun;
  else if (verb && noun && !noun.includes(" ")) subject = `${noun} para ${query}`;
  else if (query) subject = capitalize(query);
  else subject = noun ?? "Lugares para salir";
  // Con opciones de la barra: en lugar de la intención ("Tragos en Montevideo"); con una consulta propia, entre
  // paréntesis después de ella ("Rooftop (tragos) en Montevideo").
  const subs = input.subs ?? [];
  if (subs.length > 0) {
    const ownQuery = query !== "" && !verb;
    subject = ownQuery ? `${capitalize(query)} (${subList(subs).toLocaleLowerCase("es")})` : subList(subs);
  }
  // "Ver todos" de "Cerca de": "Lugares para comer cerca de Palermo"; si el barrio vino del texto ("tragos en Palermo"),
  // repetirlo se lee mal: "Cerca de Palermo (tragos en Palermo)".
  if (input.nearby) {
    const textNeighborhood = query !== "" && input.chips.some((chip) => chip.kind === "neighborhood" && chip.fromText);
    return textNeighborhood ? `Cerca de ${input.nearby} (${query})` : `${subject} cerca de ${input.nearby}`;
  }
  return `${subject}${placeSuffix(input.chips)}`;
}

/** El <title>: el h1 y el nombre del sitio. */
export const searchTitle = (input: SearchTitleInput) => `${searchHeading(input)} · ${SITE}`;

/** La entrada del título desde la respuesta de la búsqueda; sin respuesta (falló), sólo con el texto. */
export const searchTitleInput = (query: string, response: (Pick<SearchResponse, "bar" | "interpreted"> & Partial<Pick<SearchResponse, "nearbyOnly">>) | null): SearchTitleInput => ({
  query,
  intent: response?.bar.intent?.id ?? null,
  chips: response?.interpreted.chips ?? [],
  subs: response?.bar.subs.filter((sub) => sub.active && !sub.fromText).map((sub) => sub.label) ?? [],
  nearby: response?.nearbyOnly?.label ?? null,
});
