import { CUISINES, label } from "@shared/tags.ts";
import { PRICE_SIGNS } from "./summary";

/**
 * Datos estructurados (schema.org, JSON-LD) de la ficha. Sólo datos propios de la fila de `places`: nombre,
 * descripción, URL, logo (R2), cocinas, precio y barrio. Nunca nada de Google Places (puntaje, horarios, dirección,
 * teléfono, web): sus términos no permiten guardarlo ni reusarlo fuera de lo que se muestra. Tampoco coordenadas.
 */

type SchemaType = "Restaurant" | "CafeOrCoffeeShop" | "BarOrPub" | "LocalBusiness";

/** Por la categoría principal (la primera); lo que no es restaurante, café ni bar va como LocalBusiness. */
const TYPE_BY_CATEGORY: Record<string, SchemaType> = {
  restaurant: "Restaurant",
  grill: "Restaurant",
  pizzeria: "Restaurant",
  chiviteria: "Restaurant",
  bodegon: "Restaurant",
  cafe: "CafeOrCoffeeShop",
  bar: "BarOrPub",
  brewery: "BarOrPub",
  wine_bar: "BarOrPub",
};

/** servesCuisine existe en FoodEstablishment (restaurante, café, bar), no en LocalBusiness. */
const FOOD_TYPES = new Set<SchemaType>(["Restaurant", "CafeOrCoffeeShop", "BarOrPub"]);

export type JsonLdPlace = {
  slug: string;
  name: string;
  description_es: string | null;
  categories: string[];
  tags: string[];
  price: string;
};

type Input = {
  place: JsonLdPlace;
  /** Base pública del sitio (siteUrl()), sin barra final. */
  siteUrl: string;
  /** El logo en R2; null sin logo. */
  logoUrl: string | null;
  /** El nombre del barrio; null si no hay. */
  neighborhood: string | null;
};

export function schemaType(categories: string[]): SchemaType {
  return (categories[0] && TYPE_BY_CATEGORY[categories[0]]) || "LocalBusiness";
}

export function placeJsonLd(input: Input): Record<string, unknown> {
  const { place } = input;
  const type = schemaType(place.categories);
  const description = place.description_es?.replace(/\s+/g, " ").trim();
  const cuisines = place.tags.filter((tag) => tag in CUISINES).map((tag) => label(tag, "es"));
  const priceRange = PRICE_SIGNS[place.price];

  return {
    "@context": "https://schema.org",
    "@type": type,
    name: place.name,
    ...(description ? { description } : {}),
    url: `${input.siteUrl}/place/${place.slug}`,
    ...(input.logoUrl ? { logo: input.logoUrl, image: input.logoUrl } : {}),
    ...(FOOD_TYPES.has(type) && cuisines.length ? { servesCuisine: cuisines } : {}),
    ...(priceRange ? { priceRange } : {}),
    address: { "@type": "PostalAddress", addressLocality: "Montevideo", addressCountry: "UY" },
    ...(input.neighborhood ? { containedInPlace: { "@type": "Place", name: `${input.neighborhood}, Montevideo` } } : {}),
  };
}

/** El JSON para el <script>: `<` escapado, así ningún texto puede cerrar el script (`</script>`). */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
