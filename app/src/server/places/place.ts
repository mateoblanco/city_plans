import 'server-only'
import { cache } from 'react'
import { sql } from 'drizzle-orm'
import { getDb } from '../db'

/** Fila de places tal como está en la base, sin los textos de búsqueda ni el embedding. */
export type PlaceRow = Record<string, unknown> & {
  slug: string
  name: string
  neighborhood_id: string
  description_es: string | null
  google_place_id: string | null
}

const SLUG = /^[a-z0-9-]{1,200}$/
const DESCRIPTION_MAX = 155

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug)
}

/** description_es para la meta description: hasta 155 caracteres, cortada en una palabra. undefined si está vacía. */
export function metaDescription(text: string | null): string | undefined {
  const clean = text?.replace(/\s+/g, ' ').trim()
  if (!clean) return undefined
  if (clean.length <= DESCRIPTION_MAX) return clean
  const cut = clean.slice(0, DESCRIPTION_MAX - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, '')}…`
}

// cache de React: generateMetadata y la página comparten una consulta por request. Nada se guarda entre requests.
// search_tsv sale de keyword_text (el mismo texto en tokens), así que tampoco va.
export const getPublishedPlace = cache(async (slug: string): Promise<PlaceRow | null> => {
  if (!isValidSlug(slug)) return null
  const { rows } = await getDb().execute(sql`
    select to_jsonb(p) - 'embedding' - 'embedding_text' - 'keyword_text' - 'search_tsv' as row
    from places p
    where p.slug = ${slug} and p.status = 'published'
    limit 1
  `)
  return ((rows[0] as { row: PlaceRow } | undefined)?.row) ?? null
})
