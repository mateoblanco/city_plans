import type { DayHours, PlaceGoogleInfo } from "@/server/places/google";
import { whenVisible } from "@/components/Tracking/utils/view";

/** La ruta que pide Place Details del lugar (app/api/place-google/[id]/route.ts), por nuestro id. */
export const placeGoogleUrl = (placeId: string) => `/api/place-google/${encodeURIComponent(placeId)}`;

export type LoadDeps = {
  fetchFn: (input: string, init: RequestInit) => Promise<Response>;
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const text = (value: unknown) => (typeof value === "string" && value ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isDay = (value: unknown): value is DayHours =>
  isRecord(value) && Number.isInteger(value.day) && typeof value.allDay === "boolean" && Array.isArray(value.ranges) && value.ranges.every((range) => typeof range === "string");

/** Lee la respuesta de la ruta sin confiar en su forma: lo que no es válido queda en null. null si no es un objeto. */
export function readPlaceGoogle(body: unknown): PlaceGoogleInfo | null {
  if (!isRecord(body)) return null;
  const week = Array.isArray(body.week) && body.week.length === 7 && body.week.every(isDay) ? body.week : null;
  return {
    openNow: typeof body.openNow === "boolean" ? body.openNow : null,
    rating: num(body.rating),
    ratingCount: num(body.ratingCount),
    reviewsHref: text(body.reviewsHref),
    address: text(body.address),
    week,
    website: text(body.website),
    whatsappHref: text(body.whatsappHref),
  };
}

/**
 * Pide lo de Google de la ficha una sola vez: cuando la página está visible (ya, o al volver a la pestaña), nunca en el
 * render del servidor ni en el prefetch (se llama desde un efecto). `started` evita la segunda llamada si el efecto
 * corre dos veces (StrictMode). Sin reintentos: un error, un 204 (bot, límite o falla de Google) o una respuesta rara
 * terminan en `onResult(null)`. Devuelve la limpieza del efecto (deja de esperar la visibilidad).
 */
export function loadPlaceGoogle(
  placeId: string,
  started: { current: boolean },
  onResult: (info: PlaceGoogleInfo | null) => void,
  deps: LoadDeps,
): () => void {
  if (started.current) return () => {};
  return whenVisible(deps.doc, () => {
    if (started.current) return;
    started.current = true;
    deps
      .fetchFn(placeGoogleUrl(placeId), { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => (response.status === 200 ? readPlaceGoogle(await response.json()) : null))
      .catch(() => null)
      .then(onResult);
  });
}
