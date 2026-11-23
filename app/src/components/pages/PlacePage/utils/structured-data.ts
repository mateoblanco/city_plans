import { CUISINES, label } from "@shared/tags.ts";
import type { Hours } from "@/server/search/hours";
import { instagramHandle, PRICE_SIGNS } from "./summary";

/**
 * Datos estructurados (schema.org, JSON-LD) de la ficha. Sólo datos propios de la fila de `places`: nombre,
 * descripción, URL, logo (R2), cocinas, precio, barrio, horarios (los de la base, de fuentes propias: la web, el
 * Instagram o a mano) e Instagram y web propios. Nunca nada de Google Places (puntaje, horarios, dirección, teléfono,
 * web): sus términos no permiten guardarlo ni reusarlo fuera de lo que se muestra. Tampoco la calle ni coordenadas.
 */

type SchemaType = "Restaurant" | "CafeOrCoffeeShop" | "BarOrPub" | "Bakery" | "IceCreamShop" | "LocalBusiness";

/** Por la categoría principal (la primera); lo que no tiene tipo propio va como LocalBusiness. */
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
  bakery: "Bakery",
  ice_cream_shop: "IceCreamShop",
};

/** servesCuisine existe en FoodEstablishment (todos los de arriba), no en LocalBusiness. */
const FOOD_TYPES = new Set<SchemaType>(["Restaurant", "CafeOrCoffeeShop", "BarOrPub", "Bakery", "IceCreamShop"]);

/** 0 = domingo, como `hours.slots`. */
const SCHEMA_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export type JsonLdPlace = {
  slug: string;
  name: string;
  description_es: string | null;
  categories: string[];
  tags: string[];
  price: string;
  hours: Hours;
  instagram: string | null;
  website: string | null;
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

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * openingHoursSpecification desde los horarios de la base, sólo si están completos (`exact`): con `partial` faltarían
 * días y se leerían como cerrados. Un turno sin cierre conocido (`closes: null`) no va. Un turno que pasa la medianoche
 * va como está (cierre antes que apertura), como pide Google. Los turnos del mismo horario se juntan en una entrada.
 */
export function openingHours(hours: Hours | null | undefined): Record<string, unknown>[] {
  if (!hours || hours.status !== "exact") return [];
  const byTime = new Map<string, number[]>();
  for (const slot of hours.slots) {
    if (!SCHEMA_DAYS[slot.day] || !TIME.test(slot.opens) || !slot.closes || !TIME.test(slot.closes)) continue;
    const key = `${slot.opens}-${slot.closes}`;
    const days = byTime.get(key) ?? [];
    if (!days.includes(slot.day)) days.push(slot.day);
    byTime.set(key, days);
  }
  return [...byTime].map(([key, days]) => {
    const [opens, closes] = key.split("-");
    return {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => `https://schema.org/${SCHEMA_DAYS[day]}`),
      opens,
      closes,
    };
  });
}

/** La web propia como URL absoluta (https si no trae esquema); null si no parece una URL. */
function websiteUrl(value: string | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** Instagram y web propios (de la fila), para sameAs. */
export function sameAs(place: Pick<JsonLdPlace, "instagram" | "website">): string[] {
  const handle = instagramHandle(place.instagram);
  const links = [handle ? `https://www.instagram.com/${handle}/` : null, websiteUrl(place.website)];
  return links.filter((link, index): link is string => !!link && links.indexOf(link) === index);
}

export function placeJsonLd(input: Input): Record<string, unknown> {
  const { place } = input;
  const type = schemaType(place.categories);
  const description = place.description_es?.replace(/\s+/g, " ").trim();
  const cuisines = place.tags.filter((tag) => tag in CUISINES).map((tag) => label(tag, "es"));
  const priceRange = PRICE_SIGNS[place.price];
  const hours = openingHours(place.hours);
  const links = sameAs(place);

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
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
    ...(links.length ? { sameAs: links } : {}),
  };
}

/** El JSON para el <script>: `<` escapado, así ningún texto puede cerrar el script (`</script>`). */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
