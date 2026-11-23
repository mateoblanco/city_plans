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
