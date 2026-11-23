import { randomUUID } from 'node:crypto'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import { STALE_AFTER_MONTHS, type GuideCity, type GuideStatus } from '../../src/data/guides.ts'
import type { GuideDetail, GuideInput, GuideIntro, GuidePlaceDetail, GuideSummary, GuideWarning } from '../../src/types/guides.ts'
import type { CandidateExtra } from './candidates.ts'
import type { PlacePromptRow } from './prompts.ts'

/**
 * Lectura y escritura de las guías (guides, guide_places, guide_intros). SQL como texto con parámetros para que lo
 * corra Neon en producción y PGlite en los tests (store-db.test.ts), igual que popularidad.
 */
export type Statement = { text: string; params: unknown[] }

export type SqlRunner = {
  query(text: string, params?: unknown[]): Promise<Record<string, unknown>[]>
  /** Todas o ninguna. */
  transaction(statements: Statement[]): Promise<void>
}

/** Un lugar de places, para validar los de una guía. */
export type PlaceRef = { id: string; name: string; status: string; neighborhoodId: string | null }

export type GuidesStore = {
  list(now?: Date): Promise<GuideSummary[]>
  get(id: string): Promise<GuideDetail | null>
  /** Si el slug ya lo usa otra guía de la ciudad. */
  slugTaken(city: GuideCity, slug: string, exceptId?: string): Promise<boolean>
  places(ids: string[]): Promise<PlaceRef[]>
  /** Crea (sin id) o reemplaza la guía y sus lugares, en ese orden. `touchContent`: la fecha de actualización pasa a hoy. Devuelve el id. */
  save(input: GuideInput, options: { id?: string; touchContent: boolean }): Promise<string>
  setStatus(id: string, status: GuideStatus): Promise<boolean>
  setFeatured(id: string, featured: boolean): Promise<boolean>
  /**
   * Borra una guía que no está publicada (sus lugares se van con ella: guide_places tiene cascade). Una publicada no se
   * borra: hay que despublicarla antes. El chequeo va en la misma sentencia, así no hay carrera con un "Publicar".
   */
  remove(id: string): Promise<'deleted' | 'published' | 'not_found'>
  /** Suma lo gastado en IA a la guía; devuelve el total nuevo (null si la guía no existe). */
  addAiCost(id: string, usd: number): Promise<number | null>
  /** Los datos de los lugares para el prompt, en el orden pedido (sólo columnas permitidas: prompts.ts). */
  placesForPrompt(ids: string[]): Promise<PlacePromptRow[]>
  /** Tags y descripción para los candidatos de la búsqueda. */
  candidateExtras(ids: string[]): Promise<CandidateExtra[]>
  /** Para la intro de un barrio (id) o de la ciudad (null): sus guías publicadas y los tipos y tags de sus lugares publicados. */
  areaData(neighborhoodId: string | null): Promise<AreaData>
  /**
   * Por barrio, las guías que cuentan para que su página exista en la app (MIN_NEIGHBORHOOD_GUIDES): publicadas y con
   * algún lugar publicado, la misma regla que la app (las que tienen página).
   */
  neighborhoodGuideCounts(): Promise<Record<string, number>>
  intros(): Promise<GuideIntro[]>
  /** Una intro vacía borra la fila. */
  saveIntro(city: GuideCity, neighborhoodId: string | null, intro: string): Promise<void>
}

/** Lo crudo de un barrio o de la ciudad para su intro (prompts.ts lo resume). */
export type AreaData = {
  guides: { title: string; group: string; neighborhoodId: string | null }[]
  categories: string[]
  tags: string[]
  placeCount: number
}

/** Sólo las columnas que pueden llegar al prompt (prompts.ts PLACE_FACT_KEYS; el precio como palabra fija); nada de horario, contacto ni Google. */
const PROMPT_PLACES_SQL = `
  select id::text as id, name, neighborhood_id as "neighborhoodId", located_in as "locatedIn", categories, tags, signature,
    dishes, description_es as "descriptionEs", highlights, style, price, diet_vegan as "dietVegan",
    diet_vegetarian as "dietVegetarian", diet_gluten_free as "dietGlutenFree"
  from places where id::text = any($1::text[])`

/** Un slug repetido en la ciudad que llegó a la base (dos guardados a la vez): el unique de guides. */
export class SlugTakenError extends Error {
  constructor() {
    super('Ya hay una guía con ese slug en la ciudad.')
  }
}

const iso = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`

const LIST_SQL = `
  select g.id::text as id, g.slug, g.city, g.neighborhood_id as "neighborhoodId", g."group" as "group", g.title, g.status,
    g.featured, ${iso('g.published_at')} as "publishedAt", ${iso('g.content_updated_at')} as "contentUpdatedAt",
    count(gp.place_id)::int as "placeCount",
    coalesce(array_agg(p.name order by gp.position) filter (where p.status <> 'published'), '{}') as "unpublishedPlaces"
  from guides g
  left join guide_places gp on gp.guide_id = g.id
  left join places p on p.id = gp.place_id
  group by g.id
  order by g.content_updated_at desc, g.title`

const GUIDE_SQL = `
  select g.id::text as id, g.slug, g.city, g.neighborhood_id as "neighborhoodId", g."group" as "group", g.title,
    g.seo_title as "seoTitle", g.seo_description as "seoDescription", g.intro, g.status, g.featured, g.color,
    ${iso('g.published_at')} as "publishedAt", ${iso('g.content_updated_at')} as "contentUpdatedAt",
    g.ai_cost_usd::float8 as "aiCostUsd"
  from guides g where g.id::text = $1`

const GUIDE_PLACES_SQL = `
  select gp.place_id::text as "placeId", gp.text, p.name, p.slug, p.neighborhood_id as "neighborhoodId", p.status
  from guide_places gp join places p on p.id = gp.place_id
  where gp.guide_id::text = $1
  order by gp.position`

type ListRow = Omit<GuideSummary, 'warnings'> & { unpublishedPlaces: string[] }

/** Meses enteros entre dos fechas (como un calendario: del 19/5 al 18/11 son 5). */
export function monthsBetween(from: Date, to: Date): number {
  const months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
  return to.getUTCDate() < from.getUTCDate() ? months - 1 : months
}

/**
 * Los avisos de una guía del listado (sólo publicadas): algún lugar que ya no está publicado (la app lo saltea) y más
 * de STALE_AFTER_MONTHS meses sin cambios de contenido.
 */
export function guideWarnings(row: { status: GuideStatus; unpublishedPlaces: readonly string[]; contentUpdatedAt: string }, now: Date): GuideWarning[] {
  if (row.status !== 'published') return []
  const warnings: GuideWarning[] = []
  if (row.unpublishedPlaces.length > 0) warnings.push({ code: 'unpublished_places', places: [...row.unpublishedPlaces] })
  const months = monthsBetween(new Date(row.contentUpdatedAt), now)
  if (months >= STALE_AFTER_MONTHS) warnings.push({ code: 'stale', months })
  return warnings
}

function isSlugUnique(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { code, constraint, message } = error as { code?: string; constraint?: string; message?: string }
  return code === '23505' && (constraint === 'guides_city_slug_unique' || /guides_city_slug_unique/.test(message ?? ''))
}

export function sqlGuidesStore(db: SqlRunner): GuidesStore {
  return {
    async list(now = new Date()) {
      const rows = (await db.query(LIST_SQL)) as ListRow[]
      return rows.map(({ unpublishedPlaces, ...row }) => ({ ...row, warnings: guideWarnings({ ...row, unpublishedPlaces }, now) }))
    },

    async get(id) {
      const [row] = (await db.query(GUIDE_SQL, [id])) as Omit<GuideDetail, 'places'>[]
      if (!row) return null
      const places = (await db.query(GUIDE_PLACES_SQL, [id])) as GuidePlaceDetail[]
      return { ...row, places }
    },

    async slugTaken(city, slug, exceptId) {
      const rows = await db.query(`select 1 from guides where city = $1 and slug = $2 and ($3::text is null or id::text <> $3) limit 1`, [city, slug, exceptId ?? null])
      return rows.length > 0
    },

    async places(ids) {
      if (ids.length === 0) return []
      return (await db.query(
        `select id::text as id, name, status, neighborhood_id as "neighborhoodId" from places where id::text = any($1::text[])`,
        [ids],
      )) as PlaceRef[]
    },

    async save(input, { id, touchContent }) {
      const guideId = id ?? randomUUID()
      const upsert: Statement = {
        text: `
          insert into guides (id, slug, city, neighborhood_id, "group", title, seo_title, seo_description, intro, featured, color)
          values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          on conflict (id) do update set
            slug = excluded.slug, city = excluded.city, neighborhood_id = excluded.neighborhood_id, "group" = excluded."group",
            title = excluded.title, seo_title = excluded.seo_title, seo_description = excluded.seo_description,
            intro = excluded.intro, featured = excluded.featured, color = excluded.color,
            content_updated_at = case when $12::boolean then now() else guides.content_updated_at end,
            updated_at = now()`,
        params: [guideId, input.slug, input.city, input.neighborhoodId, input.group, input.title, input.seoTitle, input.seoDescription, input.intro, input.featured, input.color, touchContent],
      }
      const statements: Statement[] = [
        upsert,
        { text: `delete from guide_places where guide_id = $1::uuid`, params: [guideId] },
      ]
      if (input.places.length > 0) {
        statements.push({
          text: `
            insert into guide_places (guide_id, place_id, position, text)
            select $1::uuid, p.place_id::uuid, (p.ord - 1)::int, p.text
            from unnest($2::text[], $3::text[]) with ordinality as p(place_id, text, ord)`,
          params: [guideId, input.places.map((place) => place.placeId), input.places.map((place) => place.text)],
        })
      }
      try {
        await db.transaction(statements)
      } catch (error) {
        if (isSlugUnique(error)) throw new SlugTakenError()
        throw error
      }
      return guideId
    },

    async setStatus(id, status) {
      const rows = await db.query(
        `update guides set status = $2, published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end,
           updated_at = now() where id::text = $1 returning id`,
        [id, status],
      )
      return rows.length > 0
    },

    async remove(id) {
      const deleted = await db.query(`delete from guides where id::text = $1 and status <> 'published' returning id`, [id])
      if (deleted.length > 0) return 'deleted'
      const exists = await db.query(`select 1 from guides where id::text = $1`, [id])
      return exists.length > 0 ? 'published' : 'not_found'
    },

    async setFeatured(id, featured) {
      const rows = await db.query(`update guides set featured = $2, updated_at = now() where id::text = $1 returning id`, [id, featured])
      return rows.length > 0
    },

    async addAiCost(id, usd) {
      const rows = (await db.query(`update guides set ai_cost_usd = ai_cost_usd + $2 where id::text = $1 returning ai_cost_usd::float8 as total`, [id, usd])) as { total: number }[]
      return rows[0]?.total ?? null
    },

    async placesForPrompt(ids) {
      if (ids.length === 0) return []
      const rows = (await db.query(PROMPT_PLACES_SQL, [ids])) as PlacePromptRow[]
      const byId = new Map(rows.map((row) => [row.id, row]))
      return ids.flatMap((placeId) => byId.get(placeId) ?? [])
    },

    async candidateExtras(ids) {
      if (ids.length === 0) return []
      return (await db.query(`select id::text as id, tags, description_es as "descriptionEs" from places where id::text = any($1::text[])`, [ids])) as CandidateExtra[]
    },

    async areaData(neighborhoodId) {
      const guides = (await db.query(
        `select title, "group" as "group", neighborhood_id as "neighborhoodId" from guides
         where status = 'published' and ($1::text is null or neighborhood_id = $1) order by created_at`,
        [neighborhoodId],
      )) as AreaData['guides']
      const places = (await db.query(
        `select categories, tags from places where status = 'published' and ($1::text is null or neighborhood_id = $1)`,
        [neighborhoodId],
      )) as { categories: string[]; tags: string[] }[]
      return { guides, categories: places.flatMap((place) => place.categories), tags: places.flatMap((place) => place.tags), placeCount: places.length }
    },

    async neighborhoodGuideCounts() {
      const rows = (await db.query(
        `select g.neighborhood_id as "neighborhoodId", count(*)::int as count
         from guides g
         where g.status = 'published' and g.neighborhood_id is not null
           and exists (select 1 from guide_places gp join places p on p.id = gp.place_id where gp.guide_id = g.id and p.status = 'published')
         group by g.neighborhood_id`,
      )) as { neighborhoodId: string; count: number }[]
      return Object.fromEntries(rows.map((row) => [row.neighborhoodId, row.count]))
    },

    async intros() {
      return (await db.query(
        `select city, neighborhood_id as "neighborhoodId", intro, ${iso('updated_at')} as "updatedAt" from guide_intros order by neighborhood_id nulls first`,
      )) as GuideIntro[]
    },

    async saveIntro(city, neighborhoodId, intro) {
      if (!intro.trim()) {
        await db.query(`delete from guide_intros where city = $1 and neighborhood_id is not distinct from $2`, [city, neighborhoodId])
        return
      }
      await db.query(
        `insert into guide_intros (city, neighborhood_id, intro) values ($1, $2, $3)
         on conflict on constraint guide_intros_city_neighborhood_unique do update set intro = excluded.intro, updated_at = now()`,
        [city, neighborhoodId, intro],
      )
    },
  }
}

/** Neon en producción: las escrituras de un guardado van en una transacción HTTP. */
export function neonGuidesStore(client: NeonQueryFunction<false, false>): GuidesStore {
  return sqlGuidesStore({
    query: (text, params = []) => client.query(text, params) as Promise<Record<string, unknown>[]>,
    transaction: async (statements) => {
      await client.transaction(statements.map((statement) => client.query(statement.text, statement.params)))
    },
  })
}

