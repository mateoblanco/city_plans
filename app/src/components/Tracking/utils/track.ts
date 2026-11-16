import type { EventOrigin, EventType } from "@shared/events.ts";

/**
 * Eventos de popularidad del lado del navegador. Este módulo es lo único que se carga siempre (lo importan las cards y
 * los botones) y no envía nada solo: el envío (send.ts) es otro chunk, que se pide con import() recién cuando
 * TrackingEnabled (el layout lo renderiza sólo con TRACK_EVENTS=true) prende el envío o la ficha cuenta una vista.
 * Apagado, send.ts nunca se baja. Todo vive en memoria del módulo: sin cookies ni localStorage.
 */
export type Origin = { origin: EventOrigin; row: string | null };
export type EventPayload = { placeId: string } & Origin & { type: EventType };
export type Sender = (payload: EventPayload) => void;

/** El envío real, en su propio chunk: sólo se baja la primera vez que se pide. Si falla, se pierde. */
const lazySend: Sender = (payload) => {
  import("./send").then((module) => module.sendEvent(payload)).catch(() => {});
};

export const DIRECT: Origin = { origin: "direct", row: null };

let sender: Sender | null = null;
// Origen del último click a una ficha (con su slug), hasta que esa ficha se muestre.
let pending: { slug: string; origin: Origin } | null = null;
// Origen de la ficha que se está mostrando: lo usan guardar y "Google Maps" de esa ficha.
let current: { placeId: string; origin: Origin } | null = null;

/** Prende el envío (TrackingEnabled). Sin argumento, el de send.ts, que se empieza a bajar ya para tenerlo listo. */
export function enableTracking(send?: Sender) {
  if (send) {
    sender = send;
    return;
  }
  import("./send").catch(() => {});
  sender = lazySend;
}

/** Al tocar un link a una ficha (card de búsqueda, fila de la home, similares, sucursal). */
export function markOrigin(slug: string, origin: Origin) {
  pending = { slug, origin };
}

/**
 * La ficha se mostró: toma el origen del click si era a esta ficha (si no, directo: link externo, recarga, atrás o
 * pestaña nueva) y lo deja como el de la ficha actual. El origen se usa una sola vez.
 */
export function startView(placeId: string, slug: string): Origin {
  const origin = pending?.slug === slug ? pending.origin : DIRECT;
  pending = null;
  current = { placeId, origin };
  return origin;
}

/** Origen de un evento de la ficha (guardar, "Google Maps"): el de la vista de esa ficha, o directo. */
export const originFor = (placeId: string): Origin => (current?.placeId === placeId ? current.origin : DIRECT);

/**
 * La ficha se mostró (PlaceViewBeacon, que sólo se renderiza con TRACK_EVENTS=true): toma el origen y manda la vista.
 * No depende de enableTracking: el efecto de la ficha corre antes que el del layout.
 */
export function trackView(placeId: string, slug: string, send: Sender = lazySend) {
  send({ placeId, type: "view", ...startView(placeId, slug) });
}

/** Manda un evento si el envío está prendido; si no, no hace nada. Nunca espera ni tira error. */
export function track(placeId: string, type: EventType, origin: Origin = originFor(placeId)) {
  sender?.({ placeId, type, ...origin });
}

/** Para los tests. */
export function resetTracking() {
  sender = null;
  pending = null;
  current = null;
}
