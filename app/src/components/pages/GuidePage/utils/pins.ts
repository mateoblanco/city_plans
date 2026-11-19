/** Un pin del mapa de la guía: el mismo número que en la lista. */
export type GuidePin = { id: string; number: number; name: string; lat: number; lng: number };

/** Límites que encierran todos los pins (como literal: no depende del global `google`). null sin pins. */
export function pinBounds(pins: readonly GuidePin[]) {
  if (pins.length === 0) return null;
  const lats = pins.map((pin) => pin.lat);
  const lngs = pins.map((pin) => pin.lng);
  return { north: Math.max(...lats), south: Math.min(...lats), east: Math.max(...lngs), west: Math.min(...lngs) };
}
