import { SITE_ALTERNATE_NAME, SITE_NAME } from "@/lib/site";

/** El ícono cuadrado del sitio (public/), el logo de Organization: Google pide al menos 112×112 y una URL rastreable. */
export const ORGANIZATION_LOGO_PATH = "/android-chrome-512x512.png";

/**
 * Datos estructurados de la home: WebSite (el nombre del sitio en los resultados de Google: `name` y `alternateName`)
 * y Organization (nombre y logo), unidos por @id. Sin SearchAction: Google ya no muestra la caja de búsqueda del sitio.
 */
export function homeJsonLd(siteUrl: string): Record<string, unknown> {
  const url = `${siteUrl}/`;
  const organization = `${url}#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${url}#website`, name: SITE_NAME, alternateName: SITE_ALTERNATE_NAME, url, inLanguage: "es-UY", publisher: { "@id": organization } },
      { "@type": "Organization", "@id": organization, name: SITE_NAME, url, logo: `${siteUrl}${ORGANIZATION_LOGO_PATH}` },
    ],
  };
}
