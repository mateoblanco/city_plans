/** Lo que el JSON-LD necesita de cada fila: las guías en el orden en que se ven. */
type JsonLdGroup = { guides: { title: string; href: string }[] };

/**
 * CollectionPage de la ciudad con un ItemList de las guías que muestra (por grupo y dentro de cada uno, en el orden de
 * la página). Sin migas: es la raíz de las guías. Sin nada de Google.
 */
export function cityCollectionJsonLd(input: { title: string; description: string; path: string; siteUrl: string; groups: JsonLdGroup[] }) {
  const guides = input.groups.flatMap((group) => group.guides);
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: input.title,
    description: input.description,
    url: `${input.siteUrl}${input.path}`,
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: guides.length,
      itemListElement: guides.map((guide, index) => ({ "@type": "ListItem", position: index + 1, name: guide.title, url: `${input.siteUrl}${guide.href}` })),
    },
  };
}
