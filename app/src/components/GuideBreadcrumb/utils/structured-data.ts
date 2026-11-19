/** Un tramo de las migas para el JSON-LD: el nombre y su ruta (relativa al sitio). */
export type BreadcrumbJsonLdItem = { label: string; href?: string };

/** BreadcrumbList con URLs absolutas reales (las páginas de ciudad, barrio y guía existen). */
export function breadcrumbJsonLd(items: BreadcrumbJsonLdItem[], siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: `${siteUrl}${item.href}` } : {}),
    })),
  };
}
