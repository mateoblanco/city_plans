import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import barrios from "./barrios.json" with { type: "json" };

export function getBarrio(lat: number, lng: number): string | null {
  const punto = [lng, lat]; // ojo: primero lng, después lat
  for (const barrio of barrios.features) {
    if (booleanPointInPolygon(punto, barrio as any)) {
      return barrio.properties.barrio // el nombre del campo depende del archivo
    }
  }
  return null;
}

export function getNeighborhood(lat: number, lng: number) {
  return { neighborhoodId: getBarrio(lat, lng) }
}

// Ejemplo: getBarrio(-34.9086, -56.2085) → "Ciudad Vieja"

export const NEIGHBORHOOD_IDS: readonly string[] = barrios.features.map((barrio) => barrio.properties.barrio)

export function getNeighborhoodFeature(neighborhoodId: string) {
  return barrios.features.find((barrio) => barrio.properties.barrio === neighborhoodId) ?? null
}
