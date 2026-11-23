import { metaDescription } from "@/server/places/place";
import { mainCategory } from "./summary";

type MetadataPlace = { name: string; categories: string[]; description_es: string | null };

/** "<Categoría> en <Barrio>, Montevideo" (sin categoría, "En <Barrio>, Montevideo"; sin barrio, "<Categoría> en Montevideo"). */
function where(place: MetadataPlace, neighborhood: string | null): string {
  const category = mainCategory(place.categories);
  const location = neighborhood ? `${neighborhood}, Montevideo` : "Montevideo";
  return category ? `${category} en ${location}` : `En ${location}`;
}

/** El título de la ficha sin el nombre del sitio: "Ramona · Café en Buceo, Montevideo". */
export function placeTitle(place: MetadataPlace, neighborhood: string | null): string {
  return `${place.name} · ${where(place, neighborhood)}`;
}

/**
 * La meta description: nuestra descripción (description_es), hasta 155 caracteres, cortada en una palabra y con "…";
 * sin descripción, "Ramona: café en Buceo, Montevideo.".
 */
export function placeDescription(place: MetadataPlace, neighborhood: string | null): string {
  const own = metaDescription(place.description_es);
  if (own) return own;
  const text = where(place, neighborhood);
  return `${place.name}: ${text.charAt(0).toLowerCase()}${text.slice(1)}.`;
}
