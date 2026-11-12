import { roundCoord } from "./coords";

/**
 * Ubicación de la búsqueda, compartida por el cliente y el servidor (sin dependencias: va al cliente).
 *
 * URL (`loc`): `near` (cerca mío: nunca lleva coordenadas, usa la ubicación de quien abre el link), `all` (todo
 * Montevideo) o una zona del mapa `s,w,n,e` (3 decimales, redondeada hacia afuera). Sin `loc`, la ubicación por defecto
 * la resuelve el servidor (server/search/location.ts).
 *
 * Cookie `loc`: la ubicación de la persona redondeada a 3 decimales (~100 m), `denied` (negó el permiso: no se vuelve a
 * pedir solo) o `skip` (falló o tardó: no se vuelve a pedir en esta sesión). La escribe sólo el cliente; la lee el
 * servidor en cada pedido de búsqueda y nunca se guarda.
 */

export type LatLng = { lat: number; lng: number };
export type Bounds = { south: number; west: number; north: number; east: number };

export type LocationChoice = { kind: "near" } | { kind: "all" } | { kind: "zone"; bounds: Bounds };
export type UserLocation = ({ kind: "coords" } & LatLng) | { kind: "denied" } | { kind: "skip" };

export const LOCATION_COOKIE = "loc";
/** Con coordenadas, 7 días (se renueva en cada visita con permiso); negado, un año; `skip`, sólo la sesión. */
export const LOCATION_COOKIE_MAX_AGE = { coords: 7 * 24 * 60 * 60, denied: 365 * 24 * 60 * 60 } as const;

/** Montevideo con margen: una zona se recorta a esto y una que cae afuera se descarta. */
export const MONTEVIDEO_BOUNDS: Bounds = { south: -35.05, west: -56.6, north: -34.6, east: -55.9 };

const COORD = /^-?\d{1,3}(\.\d{1,6})?$/;

const floor3 = (value: number) => Math.floor(value * 1000) / 1000;
const ceil3 = (value: number) => Math.ceil(value * 1000) / 1000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Redondea hacia afuera (nunca achica lo visible) y recorta a Montevideo. null si queda vacía o fuera. */
export function normalizeBounds(bounds: Bounds): Bounds | null {
  const values = [bounds.south, bounds.west, bounds.north, bounds.east];
  if (values.some((value) => !Number.isFinite(value))) return null;
  const limit = MONTEVIDEO_BOUNDS;
  const south = clamp(floor3(bounds.south), limit.south, limit.north);
  const north = clamp(ceil3(bounds.north), limit.south, limit.north);
  const west = clamp(floor3(bounds.west), limit.west, limit.east);
  const east = clamp(ceil3(bounds.east), limit.west, limit.east);
  if (!(south < north && west < east)) return null;
  return { south, west, north, east };
}

/** `s,w,n,e` para la URL. */
export const zoneParam = (bounds: Bounds) => [bounds.south, bounds.west, bounds.north, bounds.east].join(",");

export function parseZone(raw: string): Bounds | null {
  const parts = raw.split(",");
  if (parts.length !== 4 || parts.some((part) => !COORD.test(part.trim()))) return null;
  const [south, west, north, east] = parts.map(Number);
  return normalizeBounds({ south, west, north, east });
}

/**
 * `loc` de la URL. `near` viejo (`near=lat,lng`, de antes de `loc`) cuenta como cerca mío: su coordenada se ignora, es
 * la de quien compartió el link. null: sin elección (la ubicación por defecto).
 */
export function parseLocationChoice(loc: string | null | undefined, legacyNear?: string | null): LocationChoice | null {
  const value = loc?.trim() ?? "";
  if (value === "near") return { kind: "near" };
  if (value === "all") return { kind: "all" };
  if (value) {
    const bounds = parseZone(value);
    if (bounds) return { kind: "zone", bounds };
  }
  return legacyNear?.trim() ? { kind: "near" } : null;
}

export function parseLocationCookie(raw: string | null | undefined): UserLocation | null {
  const value = raw?.trim() ?? "";
  if (value === "denied") return { kind: "denied" };
  if (value === "skip") return { kind: "skip" };
  const parts = value.split(",");
  if (parts.length !== 2 || parts.some((part) => !COORD.test(part))) return null;
  const [lat, lng] = parts.map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { kind: "coords", lat: roundCoord(lat), lng: roundCoord(lng) };
}

/** Valor de la cookie: la ubicación redondeada (~100 m). */
export const locationCookieValue = (lat: number, lng: number) => `${roundCoord(lat)},${roundCoord(lng)}`;

/** Metros entre dos puntos (aproximación equirectangular: sobra para distancias de una ciudad). */
export function metersBetween(a: LatLng, b: LatLng) {
  const radians = (value: number) => (value * Math.PI) / 180;
  const x = radians(b.lng - a.lng) * Math.cos(radians((a.lat + b.lat) / 2));
  const y = radians(b.lat - a.lat);
  return Math.sqrt(x * x + y * y) * 6371008.8;
}
