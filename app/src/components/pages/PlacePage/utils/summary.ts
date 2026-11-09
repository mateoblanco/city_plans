import { label } from "@shared/tags.ts";
import { nextOpening, openStatus, type Hours } from "@/server/search/hours";
import { DISPLAY_LANG, openStateText, PRICE_LABELS, type OpenStateText } from "@/server/search/labels";

/** El precio en signos: "$", "$$", "$$$" (también el priceRange del JSON-LD). */
export const PRICE_SIGNS: Record<string, string> = { low: "$", moderate: "$$", high: "$$$" };

/** "$$ (Normal)"; null con precio desconocido. */
export function priceLabel(price: string): string | null {
  const sign = PRICE_SIGNS[price];
  return sign ? `${sign} (${PRICE_LABELS.es[price as keyof (typeof PRICE_LABELS)["es"]]})` : null;
}

/**
 * La línea de estado, con los mismos textos que la PlaceCard (similarCard): "Abierto · cierra 00:00", "Cierra pronto · 16:00",
 * "Cerrado · Abre 19:00". Sale de los horarios de la base; si no están confirmados, del abierto/cerrado de Google, y si
 * tampoco hay, null (no se muestra).
 */
export function placeOpenText(hours: Hours, googleOpenNow: boolean | null, now: { day: number; time: string }): OpenStateText | null {
  const open = openStatus(hours, now);
  if (open.state === "unconfirmed") {
    if (googleOpenNow === null) return null;
    return { tone: googleOpenNow ? "open" : "closed", prefix: "", status: googleOpenNow ? "Abierto" : "Cerrado", detail: null };
  }
  const next = open.state === "closed" ? nextOpening(hours, now) : null;
  return openStateText(open, DISPLAY_LANG, now, true, next);
}

/** La categoría principal (la primera), en español; null sin categorías. */
export function mainCategory(categories: string[]): string | null {
  return categories[0] ? label(categories[0], "es") : null;
}

/** "4,6": un decimal, con coma. */
export function ratingText(rating: number): string {
  return rating.toLocaleString("es-UY", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** El usuario de Instagram sin @, espacios ni URL; null si no queda nada válido. */
export function instagramHandle(value: string | null): string | null {
  const handle = value
    ?.trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return handle && /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

/** Palabras que ya nombran la ciudad en el nombre de un local. */
const CITY_WORDS = ["montevideo", "mvd"];

/**
 * "Lo que publica la gente": la página de Instagram de publicaciones sobre el lugar, /popular/<nombre>-montevideo/
 * ("La Pasiva" → la-pasiva-montevideo). El nombre va sin tildes ni signos, con guiones. Si el nombre ya dice la ciudad
 * ("Hotel Montevideo", "Yuzu Izakaya MVD"), no se agrega otra vez.
 */
export function instagramPopularHref(name: string): string | null {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return null;
  const hasCity = slug.split("-").some((word) => CITY_WORDS.includes(word));
  const withCity = hasCity ? slug : `${slug}-montevideo`;
  return `https://www.instagram.com/popular/${withCity}/?hl=es`;
}

/** Link a Google Maps por place_id (Maps URLs: query es obligatorio, query_place_id manda). */
export function googleMapsHref(name: string, placeId: string): string {
  const params = new URLSearchParams({ api: "1", query: name, query_place_id: placeId });
  return `https://www.google.com/maps/search/?${params}`;
}

/** Luminancia relativa (WCAG) de un #rrggbb, de 0 (negro) a 1 (blanco); null con un color inválido. */
function relativeLuminance(hex: string | null): number | null {
  const match = hex?.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;
  const [r, g, b] = match.slice(1).map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Texto claro u oscuro sobre un fondo #rrggbb (luminancia relativa); null con un color inválido. */
export function toneOn(hex: string | null): "light" | "dark" | null {
  const luminance = relativeLuminance(hex);
  if (luminance === null) return null;
  // Fondo oscuro → texto claro. 0,179 es el punto donde blanco y negro tienen el mismo contraste.
  return luminance > 0.179 ? "dark" : "light";
}

/** Por encima de esta luminancia un fondo es "casi blanco": contraste contra blanco menor a ~1,11:1. */
const NEAR_WHITE_LUMINANCE = 0.9;

/** Blanco o casi blanco (#f7f7f7 sí, #e0e0e0 no); false sin color o con uno inválido. */
export function isNearWhite(hex: string | null): boolean {
  const luminance = relativeLuminance(hex);
  return luminance !== null && luminance > NEAR_WHITE_LUMINANCE;
}

/** Líneas de ómnibus sin repetir, de la parada más cercana a la más lejana. */
export function transitLines(rows: { line: string; meters: number }[] | null | undefined): string[] {
  const sorted = [...(rows ?? [])].sort((a, b) => a.meters - b.meters);
  return [...new Set(sorted.map((row) => row.line))];
}
