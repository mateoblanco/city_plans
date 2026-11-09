import 'server-only'
import { cacheLife, cacheTag } from 'next/cache'
import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import type { SitemapPlace } from './indexing'

/** Slug y última modificación de las fichas publicadas, para el sitemap. Cambian sólo al publicar en el backoffice. */
export async function sitemapPlaces(): Promise<SitemapPlace[]> {
  'use cache'
  cacheLife('hours')
  cacheTag('sitemap-places')
  const { rows } = await getDb().execute(sql`
    select slug, updated_at as "updatedAt" from places where status = 'published' order by slug
  `)
  return rows as SitemapPlace[]
}
