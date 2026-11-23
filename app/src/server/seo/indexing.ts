import type { Metadata, MetadataRoute } from 'next'

/**
 * Indexación con interruptor (ALLOW_INDEXING). Sólo vale en Production de Vercel (VERCEL_ENV=production): en previews,
 * `next dev` y local nada se indexa aunque esté prendida. Apagada (por defecto): robots.txt bloquea todo, cada página va
 * con noindex, nofollow y el sitemap está vacío. Prendida: robots permite a todos (también a los rastreadores de LLMs) y
 * apunta al sitemap, que lista la home, las guías y las fichas publicadas; /api/, /guide-preview/ y /search van con
 * Disallow, y /search sigue con noindex (búsquedas libres: un espacio infinito de URLs, y cada una nueva paga el modelo y
 * el embedding). Se lee en el build (robots, sitemap y metadata se prerenderizan): cambiarla requiere un deploy nuevo.
 */
type Env = Record<string, string | undefined>

export const allowIndexing = (env: Env = process.env) =>
  env.ALLOW_INDEXING?.trim().toLowerCase() === 'true' && env.VERCEL_ENV?.trim() === 'production'

/** Lo de Google de la ficha (lo pide el navegador): nunca para un buscador, con la indexación apagada o prendida. */
export const PLACE_GOOGLE_DISALLOW = '/api/place-google/'

/** Con la indexación prendida: rutas internas, la vista previa de guías y las búsquedas libres. */
export const INDEXING_DISALLOW = ['/api/', '/guide-preview/', '/search']

/**
 * Rastreadores con nombre propio: los de búsqueda y de entrenamiento de LLMs. Ya entran por `*`, pero se nombran para que
 * quede explícito que se permiten. Van en el mismo grupo que `*`: en robots.txt un grupo con nombre reemplaza al de `*`
 * para ese bot, así que cada uno tiene que llevar las mismas reglas.
 */
export const NAMED_CRAWLERS = [
  'OAI-SearchBot',
  'ChatGPT-User',
  'GPTBot',
  'Claude-SearchBot',
  'Claude-User',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
]

export function robotsConfig(allow: boolean, base: string): MetadataRoute.Robots {
  if (!allow) return { rules: { userAgent: '*', disallow: ['/', PLACE_GOOGLE_DISALLOW] } }
  return {
    rules: { userAgent: ['*', ...NAMED_CRAWLERS], allow: '/', disallow: INDEXING_DISALLOW },
    sitemap: `${base}/sitemap.xml`,
  }
}

/** robots de todas las páginas (layout): sin indexación, noindex, nofollow; con ella, lo de siempre (cada página decide). */
export const rootRobots = (allow: boolean): Metadata['robots'] => (allow ? undefined : { index: false, follow: false })

/** /search nunca se indexa; con la indexación activa, sus links (las fichas) sí se siguen. */
export const searchRobots = (allow: boolean): Metadata['robots'] => ({ index: false, follow: allow })

/** Una ficha publicada: su slug y la última modificación de su fila (places.updated_at). */
export type SitemapPlace = { slug: string; updatedAt: Date | string | null }

/** Una página de guías (la ciudad, un barrio o una guía): su ruta (/guides/montevideo/…) y su última modificación. */
export type SitemapGuide = { path: string; updatedAt: string }

const toDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

const latest = (dates: (Date | null)[]): Date | null =>
  dates.reduce<Date | null>((best, date) => (date && (!best || date > best) ? date : best), null)

const lastModified = (date: Date | null) => (date ? { lastModified: date } : {})

/**
 * La home (con la modificación más nueva de lo que muestra: fichas y guías), las páginas de guías y cada ficha publicada;
 * sin indexación, vacío. Recibe sólo lo publicado: borradores, en revisión y ocultos nunca llegan acá.
 */
export function sitemapEntries(allow: boolean, base: string, places: SitemapPlace[], guides: SitemapGuide[] = []): MetadataRoute.Sitemap {
  if (!allow) return []
  const placeDates = places.map((place) => toDate(place.updatedAt))
  const guideDates = guides.map((guide) => toDate(guide.updatedAt))
  return [
    { url: `${base}/`, ...lastModified(latest([...placeDates, ...guideDates])), changeFrequency: 'daily', priority: 1 },
    ...guides.map((guide, index) => ({
      url: `${base}${guide.path}`,
      ...lastModified(guideDates[index]),
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
    ...places.map((place, index) => ({
      url: `${base}/place/${place.slug}`,
      ...lastModified(placeDates[index]),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ]
}
