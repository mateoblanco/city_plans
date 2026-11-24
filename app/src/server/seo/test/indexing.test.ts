import { describe, expect, it } from 'vitest'
import { SITE_URL } from '@/lib/site'
import { LEGAL_PAGES } from '@/lib/legal'
import { allowIndexing, NAMED_CRAWLERS, robotsConfig, rootRobots, searchRobots, sitemapEntries } from '../indexing'

const BASE = SITE_URL
const places = [
  { slug: 'trouville', updatedAt: '2026-11-01T12:00:00Z' },
  { slug: 'anastasia', updatedAt: null },
]
const guides = [
  { path: '/guides/montevideo', updatedAt: '2026-11-19' },
  { path: '/guides/montevideo/cafes-donde-nadie-te-apura', updatedAt: '2026-11-19' },
]

describe('dominio', () => {
  it('una sola URL del sitio: el dominio principal, con www y https, sin barra final', () => {
    expect(SITE_URL).toBe('https://www.adondevamos.com.uy')
  })
})

describe('interruptor ALLOW_INDEXING (sólo en Production)', () => {
  it('por defecto (sin la variable o con otro valor) no se indexa', () => {
    const production = { VERCEL_ENV: 'production' }
    expect(allowIndexing(production)).toBe(false)
    expect(allowIndexing({ ...production, ALLOW_INDEXING: 'false' })).toBe(false)
    expect(allowIndexing({ ...production, ALLOW_INDEXING: '1' })).toBe(false)
    expect(allowIndexing({ ...production, ALLOW_INDEXING: 'true' })).toBe(true)
    expect(allowIndexing({ ...production, ALLOW_INDEXING: ' TRUE ' })).toBe(true)
  })

  it('previews, desarrollo y local nunca se indexan, aunque esté prendida', () => {
    for (const VERCEL_ENV of ['preview', 'development', '', undefined]) {
      expect(allowIndexing({ ALLOW_INDEXING: 'true', VERCEL_ENV })).toBe(false)
    }
    expect(allowIndexing({ ALLOW_INDEXING: 'true', NODE_ENV: 'production' })).toBe(false)
  })
})

describe('sin indexación (antes del lanzamiento, previews y local)', () => {
  it('robots.txt: Disallow: / para todos, sin sitemap', () => {
    expect(robotsConfig(false, BASE)).toEqual({ rules: { userAgent: '*', disallow: ['/', '/api/place-google/'] } })
    expect(robotsConfig(allowIndexing({ ALLOW_INDEXING: 'true', VERCEL_ENV: 'preview' }), BASE)).toEqual(robotsConfig(false, BASE))
  })

  it('todas las páginas con noindex, nofollow; /search también', () => {
    expect(rootRobots(false)).toEqual({ index: false, follow: false })
    expect(searchRobots(false)).toEqual({ index: false, follow: false })
  })

  it('sitemap vacío aunque haya fichas y guías', () => {
    expect(sitemapEntries(false, BASE, places, guides)).toEqual([])
  })
})

describe('con indexación (lanzamiento)', () => {
  it('robots.txt: todos permitidos (también los de LLMs, con las mismas reglas), Disallow de lo interno y el sitemap absoluto', () => {
    const config = robotsConfig(true, BASE)
    expect(config).toEqual({
      rules: { userAgent: ['*', ...NAMED_CRAWLERS], allow: '/', disallow: ['/api/', '/guide-preview/', '/search'] },
      sitemap: 'https://www.adondevamos.com.uy/sitemap.xml',
    })
    for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      expect(NAMED_CRAWLERS).toContain(bot)
    }
    // /api/ cubre la ruta de Google de la ficha.
    expect('/api/place-google/x'.startsWith('/api/')).toBe(true)
  })

  it('las páginas sin robots propio se indexan; /search siempre noindex, follow', () => {
    expect(rootRobots(true)).toBeUndefined()
    expect(searchRobots(true)).toEqual({ index: false, follow: true })
  })

  it('sitemap: la home, las guías y cada ficha, con URLs absolutas del dominio y su última modificación', () => {
    const entries = sitemapEntries(true, BASE, places, guides)
    expect(entries.map((entry) => entry.url)).toEqual([
      'https://www.adondevamos.com.uy/',
      'https://www.adondevamos.com.uy/guides/montevideo',
      'https://www.adondevamos.com.uy/guides/montevideo/cafes-donde-nadie-te-apura',
      'https://www.adondevamos.com.uy/place/trouville',
      'https://www.adondevamos.com.uy/place/anastasia',
      'https://www.adondevamos.com.uy/privacy',
      'https://www.adondevamos.com.uy/terms',
    ])
    expect(entries[5]).toMatchObject({ lastModified: new Date(`${LEGAL_PAGES.privacy.updatedAt}T00:00:00Z`), changeFrequency: 'yearly' })
    expect(entries[1].lastModified).toEqual(new Date('2026-11-19T00:00:00Z'))
    expect(entries[3].lastModified).toEqual(new Date('2026-11-01T12:00:00Z'))
    expect(entries[4]).not.toHaveProperty('lastModified')
    expect(entries.some((entry) => entry.url.includes('/search') || entry.url.includes('preview'))).toBe(false)
  })

  it('sitemap: la home lleva la modificación más nueva entre fichas y guías', () => {
    expect(sitemapEntries(true, BASE, places, guides)[0].lastModified).toEqual(new Date('2026-11-19T00:00:00Z'))
    expect(sitemapEntries(true, BASE, [{ slug: 'x', updatedAt: '2026-11-21T10:00:00Z' }], guides)[0].lastModified).toEqual(new Date('2026-11-21T10:00:00Z'))
    expect(sitemapEntries(true, BASE, [], [])[0]).not.toHaveProperty('lastModified')
  })
})

describe('sitemap sin borradores ni ocultos', () => {
  it('las fichas salen sólo de places publicados (draft, review y hidden nunca), con su updated_at', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../sitemap-places.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/select slug, updated_at as "updatedAt" from places where status = 'published'/)
  })
})
