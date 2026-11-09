import type { Metadata, MetadataRoute } from 'next'

/**
 * Indexación con interruptor (ALLOW_INDEXING). Mientras no se lanza (por defecto), nada se indexa: robots.txt bloquea
 * todo, cada página va con noindex, nofollow y el sitemap está vacío. Con ALLOW_INDEXING=true: robots permite y apunta al
 * sitemap, que lista la home y las fichas publicadas; /search sigue con noindex (búsquedas libres: un espacio infinito de
 * URLs, y cada una nueva paga el modelo y el embedding). Se lee en el build (robots, sitemap y metadata se prerenderizan):
 * cambiarla requiere un deploy nuevo.
 */
type Env = Record<string, string | undefined>

export const allowIndexing = (env: Env = process.env) => env.ALLOW_INDEXING?.trim().toLowerCase() === 'true'

/**
 * URL pública del sitio (canonical, Open Graph, sitemap): SITE_URL; en Vercel, si falta, el dominio de producción del
 * proyecto; en local, localhost. Sin la barra final.
 */
export function siteUrl(env: Env = process.env): string {
  const explicit = env.SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`
  return 'http://localhost:3000'
}

export function robotsConfig(allow: boolean, base: string): MetadataRoute.Robots {
  if (!allow) return { rules: { userAgent: '*', disallow: '/' } }
  return { rules: { userAgent: '*', allow: '/' }, sitemap: `${base}/sitemap.xml` }
}

/** robots de todas las páginas (layout): sin indexación, noindex, nofollow; con ella, lo de siempre (cada página decide). */
export const rootRobots = (allow: boolean): Metadata['robots'] => (allow ? undefined : { index: false, follow: false })

/** /search nunca se indexa; con la indexación activa, sus links (las fichas) sí se siguen. */
export const searchRobots = (allow: boolean): Metadata['robots'] => ({ index: false, follow: allow })

export type SitemapPlace = { slug: string; updatedAt: Date | string | null }

/** La home y cada ficha publicada; sin indexación, vacío. */
export function sitemapEntries(allow: boolean, base: string, places: SitemapPlace[]): MetadataRoute.Sitemap {
  if (!allow) return []
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    ...places.map((place) => ({
      url: `${base}/place/${place.slug}`,
      ...(place.updatedAt ? { lastModified: new Date(place.updatedAt) } : {}),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
}
