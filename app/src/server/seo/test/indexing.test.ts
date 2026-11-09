import { describe, expect, it } from 'vitest'
import { allowIndexing, robotsConfig, rootRobots, searchRobots, siteUrl, sitemapEntries } from '../indexing'

const BASE = 'https://salimos.uy'
const places = [
  { slug: 'trouville', updatedAt: '2026-11-01T12:00:00Z' },
  { slug: 'anastasia', updatedAt: null },
]

describe('interruptor ALLOW_INDEXING', () => {
  it('por defecto (sin la variable o con otro valor) no se indexa', () => {
    expect(allowIndexing({})).toBe(false)
    expect(allowIndexing({ ALLOW_INDEXING: 'false' })).toBe(false)
    expect(allowIndexing({ ALLOW_INDEXING: '1' })).toBe(false)
    expect(allowIndexing({ ALLOW_INDEXING: 'true' })).toBe(true)
    expect(allowIndexing({ ALLOW_INDEXING: ' TRUE ' })).toBe(true)
  })
})

describe('sin indexación (antes del lanzamiento)', () => {
  it('robots.txt: Disallow: / para todos, sin sitemap', () => {
    expect(robotsConfig(false, BASE)).toEqual({ rules: { userAgent: '*', disallow: '/' } })
  })

  it('todas las páginas con noindex, nofollow; /search también', () => {
    expect(rootRobots(false)).toEqual({ index: false, follow: false })
    expect(searchRobots(false)).toEqual({ index: false, follow: false })
  })

  it('sitemap vacío aunque haya fichas', () => {
    expect(sitemapEntries(false, BASE, places)).toEqual([])
  })
})

describe('con indexación (lanzamiento)', () => {
  it('robots.txt: Allow y el link al sitemap', () => {
    expect(robotsConfig(true, BASE)).toEqual({ rules: { userAgent: '*', allow: '/' }, sitemap: `${BASE}/sitemap.xml` })
  })

  it('las páginas sin robots propio se indexan; /search siempre noindex, follow', () => {
    expect(rootRobots(true)).toBeUndefined()
    expect(searchRobots(true)).toEqual({ index: false, follow: true })
  })

  it('sitemap: la home y cada ficha publicada, con su última modificación si la hay', () => {
    const entries = sitemapEntries(true, BASE, places)
    expect(entries.map((entry) => entry.url)).toEqual([`${BASE}/`, `${BASE}/place/trouville`, `${BASE}/place/anastasia`])
    expect(entries[1].lastModified).toEqual(new Date('2026-11-01T12:00:00Z'))
    expect(entries[2]).not.toHaveProperty('lastModified')
    // Nunca /search.
    expect(entries.some((entry) => entry.url.includes('/search'))).toBe(false)
  })
})

describe('URL del sitio (metadataBase, sitemap)', () => {
  it('SITE_URL sin barra final; si no, el dominio de producción de Vercel; si no, localhost', () => {
    expect(siteUrl({ SITE_URL: 'https://salimos.uy/' })).toBe('https://salimos.uy')
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'city-plans.vercel.app' })).toBe('https://city-plans.vercel.app')
    expect(siteUrl({ SITE_URL: 'https://salimos.uy', VERCEL_PROJECT_PRODUCTION_URL: 'otro.vercel.app' })).toBe('https://salimos.uy')
    expect(siteUrl({})).toBe('http://localhost:3000')
  })
})
