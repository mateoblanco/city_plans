/** Lo que el JSON-LD necesita de cada lugar: sólo datos propios. */
export type ItemListPlace = { number: number; slug: string; name: string };

/**
 * ItemList de la guía (los lugares en su orden, con la URL de su ficha). Sin nada de Google ni coordenadas. Todavía sin
 * BreadcrumbList: las páginas de ciudad y barrio no existen (cuando estén, se suma con sus links).
 */
export function guideItemListJsonLd(input: { title: string; url: string; siteUrl: string; places: ItemListPlace[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.title,
    url: `${input.siteUrl}${input.url}`,
    numberOfItems: input.places.length,
    itemListElement: input.places.map((place) => ({
      "@type": "ListItem",
      position: place.number,
      name: place.name,
      url: `${input.siteUrl}/place/${place.slug}`,
    })),
  };
}
