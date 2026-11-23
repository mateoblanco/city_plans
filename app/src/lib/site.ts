/**
 * El nombre y la URL del sitio: el único lugar donde están escritos. El nombre lo usan los títulos (`… · <nombre>`), la
 * metadata (`siteName` de Open Graph), el manifest, los datos estructurados y los textos. La URL es la base de toda URL
 * absoluta (metadataBase, canonical, Open Graph, sitemap, robots, JSON-LD): el dominio principal, también en previews y
 * en local (los otros dominios redirigen a este; previews y local nunca se indexan). Cambiarlos requiere un deploy.
 */
export const SITE_NAME = "A Dónde Vamos";

/** Nombre alternativo (WebSite.alternateName): cómo se escribe en el dominio. */
export const SITE_ALTERNATE_NAME = "adondevamos";

/** Dominio principal, sin barra final. */
export const SITE_URL = "https://www.adondevamos.com.uy";

/** "<título> · <nombre>": el formato de la pestaña en todas las páginas. */
export const withSiteName = (title: string) => `${title} · ${SITE_NAME}`;

/**
 * Imagen para compartir por defecto (`app/opengraph-image.jpg`, la de la raíz). Las páginas de la raíz la heredan solas;
 * las de una carpeta que define su propio `openGraph` (las guías) la pierden y la ponen con esto. Las medidas tienen que
 * ser las del archivo y el alt, el de `app/opengraph-image.alt.txt` (lo verifica `lib/test/og-image.test.ts`).
 */
export const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image.jpg",
  width: 2400,
  height: 1260,
  type: "image/jpeg",
  alt: `Logo de ${SITE_NAME}`,
} as const;
