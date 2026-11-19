/** Lo que el JSON-LD necesita de cada fila: las guías en el orden en que se ven. */
type JsonLdGroup = { guides: { title: string; href: string }[] };

/**
 * ItemList de las guías del barrio (en el orden de la página: por grupo y dentro de cada uno). Sin BreadcrumbList
 * hasta que exista /guides/montevideo; sin nada de Google.
 */
export function neighborhoodItemListJsonLd(input: { name: string; path: string; siteUrl: string; groups: JsonLdGroup[] }) {
  const guides = input.groups.flatMap((group) => group.guides);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Guías de ${input.name}`,
    url: `${input.siteUrl}${input.path}`,
    numberOfItems: guides.length,
    itemListElement: guides.map((guide, index) => ({ "@type": "ListItem", position: index + 1, name: guide.title, url: `${input.siteUrl}${guide.href}` })),
  };
}
