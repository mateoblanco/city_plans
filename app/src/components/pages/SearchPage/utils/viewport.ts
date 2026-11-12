import type { Bounds } from "@/lib/location";

/** Movió el mapa: el centro se corrió más de un 10 % del alto o del ancho, o el tamaño cambió más de un 10 % (zoom). */
export const movedEnough = (from: Bounds, to: Bounds) => {
  const height = from.north - from.south;
  const width = from.east - from.west;
  const shiftLat = Math.abs((to.north + to.south) / 2 - (from.north + from.south) / 2);
  const shiftLng = Math.abs((to.east + to.west) / 2 - (from.east + from.west) / 2);
  const scale = (to.north - to.south) / height;
  return shiftLat > height * 0.1 || shiftLng > width * 0.1 || Math.abs(scale - 1) > 0.1;
};
