import { DEFAULT_GUIDE_COLOR, isGuideColor } from '@shared/guide-colors.ts'
import { introParagraphs } from '@shared/guides.ts'
import type { Guide, GuideGroup } from './types'

/**
 * Lectura de las guías desde la base (las escribe el backoffice: guides, guide_places y guide_intros). SQL crudo con
 * parámetros, sin cache: los que cachean son page-data, neighborhood-data, city-data (`'use cache'`) y el proxy
 * (routes-cache). `drafts` sólo lo pide la vista previa.
 */
export type Query = (text: string, params: unknown[]) => Promise<unknown[]>

export const GUIDES_SQL = `
  select g.id::text as id, g.slug, g.city, g.neighborhood_id as "neighborhoodId", g."group" as "group", g.title,
    g.seo_title as "seoTitle", g.seo_description as "seoDescription", g.intro, g.featured, g.color, g.status,
    to_char(g.content_updated_at at time zone 'America/Montevideo', 'YYYY-MM-DD') as "updatedAt",
    exists (
      select 1 from guide_places gp join places p on p.id = gp.place_id
      where gp.guide_id = g.id and p.status = 'published'
    ) as live,
    (
      select count(*)::int from guide_places gp join places p on p.id = gp.place_id
      where gp.guide_id = g.id and p.status = 'published'
    ) as "publishedPlaces",
    coalesce((
      select json_agg(json_build_object('id', gp.place_id::text, 'text', gp.text) order by gp.position)
      from guide_places gp where gp.guide_id = g.id
    ), '[]'::json) as places
  from guides g
  where g.city = $1 and (g.status = 'published' or $2::boolean)
  order by g.created_at, g.id`

export const INTROS_SQL = `select neighborhood_id as "neighborhoodId", intro from guide_intros where city = $1`

type GuideRow = {
  id: string
  slug: string
  city: string
  neighborhoodId: string | null
  group: string
  title: string
  seoTitle: string
  seoDescription: string
  intro: string
  featured: boolean
  color: string
  status: string
  updatedAt: string
  live: boolean
  publishedPlaces: number
  places: { id: string; text: string }[] | string
}

export function guideFromRow(row: GuideRow): Guide {
  const places = typeof row.places === 'string' ? (JSON.parse(row.places) as { id: string; text: string }[]) : row.places
  return {
    id: row.id,
    slug: row.slug,
    city: 'montevideo',
    neighborhood: row.neighborhoodId,
    group: row.group as GuideGroup,
    title: row.title,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
    intro: introParagraphs(row.intro),
    updatedAt: row.updatedAt,
    places: places.map((place) => ({ id: place.id, text: place.text })),
    featured: row.featured,
    // La base sólo acepta los de la paleta (check); igual, uno desconocido no llega al HTML.
    color: isGuideColor(row.color) ? row.color : DEFAULT_GUIDE_COLOR,
    draft: row.status !== 'published',
    live: row.live,
    publishedPlaces: Number(row.publishedPlaces) || 0,
  }
}

/** Las guías de una ciudad en el orden en que se crearon; publicadas, o también los borradores con `drafts`. */
export async function readGuides(query: Query, options: { city?: string; drafts?: boolean } = {}): Promise<Guide[]> {
  const rows = (await query(GUIDES_SQL, [options.city ?? 'montevideo', options.drafts ?? false])) as GuideRow[]
  return rows.map(guideFromRow)
}

/** Las introducciones de una ciudad: la de la ciudad (clave null) y la de cada barrio, en párrafos. */
export async function readIntros(query: Query, city = 'montevideo'): Promise<Map<string | null, string[]>> {
  const rows = (await query(INTROS_SQL, [city])) as { neighborhoodId: string | null; intro: string }[]
  return new Map(rows.map((row) => [row.neighborhoodId, introParagraphs(row.intro)]))
}
