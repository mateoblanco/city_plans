import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import type { GuideInput } from '../../src/types/guides.ts'
import { SlugTakenError, sqlGuidesStore, type GuidesStore } from './store.ts'

// Postgres real en memoria (PGlite): una tabla places mínima (lo que la 0027 necesita para la clave foránea y el status)
// y sólo las migraciones de guías (0027 y 0028). Las anteriores usan PostGIS y pgvector y no se replican.
const migration = (file: string) => readFileSync(path.resolve(import.meta.dirname, '../../drizzle', file), 'utf8')
const MIGRATION = [migration('0027_guides.sql'), migration('0028_guide_ai_cost.sql'), migration('0029_guide_color.sql'), migration('0030_guide_color_more.sql')].join('\n--> statement-breakpoint\n')

const ids = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-00000000000${n}`)

let pg: PGlite
let store: GuidesStore

const input = (overrides: Partial<GuideInput> = {}): GuideInput => ({
  slug: 'cafes-donde-nadie-te-apura',
  city: 'montevideo',
  neighborhoodId: 'CORDON',
  group: 'cafes',
  title: 'Cafés donde nadie te apura',
  seoTitle: 'Cafés en Cordón',
  seoDescription: 'Nueve cafés.',
  intro: 'Uno.\n\nDos.',
  featured: false,
  color: '#FF8E00',
  places: ids.slice(0, 4).map((placeId, index) => ({ placeId, text: `Texto ${index + 1}` })),
  ...overrides,
})

beforeEach(async () => {
  pg = new PGlite()
  await pg.exec(`create table places (id uuid primary key, name text not null, slug text not null, status text not null, neighborhood_id text,
      located_in text, categories text[] not null default '{}', tags text[] not null default '{}', signature text[] not null default '{}',
      dishes text[] not null default '{}', description_es text, highlights jsonb not null default '[]', style text,
      diet_vegan text, diet_vegetarian text, diet_gluten_free text, price text default 'moderate', hours jsonb, instagram text,
      website text, ig_followers integer, google_place_id text);
    insert into places values
      ('${ids[0]}', 'Inocencio', 'inocencio', 'published', 'CORDON'),
      ('${ids[1]}', 'Sauco', 'sauco', 'published', 'CORDON'),
      ('${ids[2]}', 'Escaramuza', 'escaramuza', 'published', 'CORDON'),
      ('${ids[3]}', 'Culto', 'culto', 'published', 'CORDON'),
      ('${ids[4]}', 'Necio', 'necio', 'published', 'CORDON');`)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) await pg.exec(statement)
  store = sqlGuidesStore({
    query: async (text, params = []) => (await pg.query<Record<string, unknown>>(text, params)).rows,
    transaction: async (statements) => {
      await pg.transaction(async (tx) => {
        for (const statement of statements) await tx.query(statement.text, statement.params)
      })
    },
  })
})

const contentDate = async (id: string) => (await pg.query<{ d: string }>(`select content_updated_at::text as d from guides where id = $1`, [id])).rows[0].d

describe('guías en Postgres (0027)', () => {
  it('crea y lee la guía con sus lugares en el orden en que se agregaron', async () => {
    const id = await store.save(input(), { touchContent: true })
    const guide = await store.get(id)
    expect(guide).toMatchObject({ slug: 'cafes-donde-nadie-te-apura', status: 'draft', neighborhoodId: 'CORDON', intro: 'Uno.\n\nDos.', publishedAt: null })
    expect(guide!.places.map((place) => place.name)).toEqual(['Inocencio', 'Sauco', 'Escaramuza', 'Culto'])
    expect(guide!.contentUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('sacar un lugar renumera sin huecos (posiciones 0..n-1)', async () => {
    const id = await store.save(input({ places: ids.map((placeId) => ({ placeId, text: 'x' })) }), { touchContent: true })
    await store.save(input({ places: [ids[0], ids[2], ids[3], ids[4]].map((placeId) => ({ placeId, text: 'x' })) }), { id, touchContent: true })
    const rows = (await pg.query<{ place_id: string; position: number }>(`select place_id::text, position from guide_places order by position`)).rows
    expect(rows).toEqual([ids[0], ids[2], ids[3], ids[4]].map((placeId, position) => ({ place_id: placeId, position })))
  })

  it('el slug es único en la ciudad (también entre barrios): el unique de la base da SlugTakenError', async () => {
    await store.save(input(), { touchContent: true })
    expect(await store.slugTaken('montevideo', 'cafes-donde-nadie-te-apura')).toBe(true)
    await expect(store.save(input({ neighborhoodId: 'PARQUE RODO' }), { touchContent: true })).rejects.toBeInstanceOf(SlugTakenError)
  })

  it('guarda el color; la base rechaza uno fuera de la paleta', async () => {
    const id = await store.save(input({ color: '#00B475' }), { touchContent: true })
    expect((await store.get(id))!.color).toBe('#00B475')
    await store.save(input({ color: '#402ACC' }), { id, touchContent: false })
    expect((await store.get(id))!.color).toBe('#402ACC')
    await expect(pg.exec(`update guides set color = '#123456'`)).rejects.toThrow(/guides_color_check/)
  })

  it('slugTaken ignora la misma guía al editarla', async () => {
    const id = await store.save(input(), { touchContent: true })
    expect(await store.slugTaken('montevideo', 'cafes-donde-nadie-te-apura', id)).toBe(false)
  })

  it('publicar fija published_at una vez; featured y un guardado sin touchContent no cambian la fecha', async () => {
    const id = await store.save(input(), { touchContent: true })
    await pg.exec(`update guides set content_updated_at = '2026-01-01T12:00:00Z'`)
    const before = await contentDate(id)
    await store.setStatus(id, 'published')
    const first = (await store.get(id))!.publishedAt
    expect(first).not.toBeNull()
    await store.setStatus(id, 'draft')
    await store.setStatus(id, 'published')
    expect((await store.get(id))!.publishedAt).toBe(first)
    await store.setFeatured(id, true)
    await store.save(input({ title: 'Otro título', featured: true }), { id, touchContent: false })
    expect(await contentDate(id)).toBe(before)
    await store.save(input({ title: 'Otro más' }), { id, touchContent: true })
    expect(await contentDate(id)).not.toBe(before)
  })

  it('avisos del listado: lugar despublicado y más de 6 meses, sólo en publicadas', async () => {
    const id = await store.save(input(), { touchContent: true })
    await pg.exec(`update places set status = 'review' where id = '${ids[1]}'`)
    expect((await store.list())[0].warnings).toEqual([])
    await store.setStatus(id, 'published')
    await pg.exec(`update guides set content_updated_at = '2026-05-01T12:00:00Z'`)
    const [row] = await store.list(new Date('2026-11-19T12:00:00Z'))
    expect(row.placeCount).toBe(4)
    expect(row.warnings).toEqual([
      { code: 'unpublished_places', places: ['Sauco'] },
      { code: 'stale', months: 6 },
    ])
    await pg.exec(`update places set status = 'published'`)
    expect((await store.list(new Date('2026-10-30T12:00:00Z')))[0].warnings).toEqual([])
  })

  it('borrar un lugar lo saca de la guía (cascade); borrar la guía, sus lugares', async () => {
    const id = await store.save(input(), { touchContent: true })
    await pg.exec(`delete from places where id = '${ids[0]}'`)
    expect((await store.get(id))!.places).toHaveLength(3)
    await pg.exec(`delete from guides`)
    expect((await pg.query(`select * from guide_places`)).rows).toEqual([])
  })

  it('introducciones: una por ciudad y por barrio (null no se repite), vacía borra', async () => {
    await store.saveIntro('montevideo', null, 'Ciudad.')
    await store.saveIntro('montevideo', null, 'Ciudad, de nuevo.')
    await store.saveIntro('montevideo', 'CORDON', 'Cordón.')
    expect((await store.intros()).map(({ neighborhoodId, intro }) => ({ neighborhoodId, intro }))).toEqual([
      { neighborhoodId: null, intro: 'Ciudad, de nuevo.' },
      { neighborhoodId: 'CORDON', intro: 'Cordón.' },
    ])
    await store.saveIntro('montevideo', 'CORDON', '  ')
    expect(await store.intros()).toHaveLength(1)
  })

  it('el check de grupo rechaza un valor fuera del catálogo', async () => {
    await expect(pg.exec(`insert into guides (slug, "group") values ('x-y-z', 'otro')`)).rejects.toThrow(/guides_group_check/)
  })

  it('el costo de IA se acumula en la guía', async () => {
    const id = await store.save(input(), { touchContent: true })
    expect((await store.get(id))!.aiCostUsd).toBe(0)
    expect(await store.addAiCost(id, 0.0123)).toBeCloseTo(0.0123, 4)
    expect(await store.addAiCost(id, 0.5)).toBeCloseTo(0.5123, 4)
    expect((await store.get(id))!.aiCostUsd).toBeCloseTo(0.5123, 4)
    expect(await store.addAiCost('00000000-0000-4000-8000-0000000000ff', 1)).toBeNull()
  })

  it('los datos para el prompt: en el orden pedido, con el nivel de precio y sin columnas prohibidas (horario, contacto, Google)', async () => {
    await pg.exec(`update places set categories = '{cafe}', tags = '{work,wifi}', description_es = 'Café tranquilo.', instagram = 'inocencio',
      website = 'https://x.uy', ig_followers = 1000, google_place_id = 'ChIJ', hours = '{"slots":[]}' where id = '${ids[0]}'`)
    const rows = await store.placesForPrompt([ids[1], ids[0]])
    expect(rows.map((row) => row.name)).toEqual(['Sauco', 'Inocencio'])
    expect(rows[1]).toMatchObject({ categories: ['cafe'], tags: ['work', 'wifi'], descriptionEs: 'Café tranquilo.' })
    expect(rows[1].price).toBe('moderate')
    for (const forbidden of ['hours', 'instagram', 'website', 'igFollowers', 'ig_followers', 'googlePlaceId', 'google_place_id']) expect(rows[1]).not.toHaveProperty(forbidden)
  })

  it('datos del barrio para su intro: guías publicadas y tipos/tags de sus lugares publicados', async () => {
    const id = await store.save(input(), { touchContent: true })
    await store.setStatus(id, 'published')
    await pg.exec(`update places set categories = '{cafe}', tags = '{work}'; update places set status = 'review' where id = '${ids[4]}'`)
    const area = await store.areaData('CORDON')
    expect(area.guides.map((guide) => guide.title)).toEqual(['Cafés donde nadie te apura'])
    expect(area.placeCount).toBe(4)
    expect(area.categories).toEqual(['cafe', 'cafe', 'cafe', 'cafe'])
    expect((await store.areaData('POCITOS')).placeCount).toBe(0)
  })

  it('guías por barrio para su página: sólo publicadas con algún lugar publicado', async () => {
    const a = await store.save(input(), { touchContent: true })
    const b = await store.save(input({ slug: 'tapas-en-cordon' }), { touchContent: true })
    await store.save(input({ slug: 'borrador-en-cordon' }), { touchContent: true })
    const c = await store.save(input({ slug: 'sin-lugares-publicados', places: [{ placeId: ids[4], text: 'x' }] }), { touchContent: true })
    for (const id of [a, b, c]) await store.setStatus(id, 'published')
    await pg.exec(`update places set status = 'review' where id = '${ids[4]}'`)
    expect(await store.neighborhoodGuideCounts()).toEqual({ CORDON: 2 })
  })

  it('eliminar: un borrador se borra con sus lugares; una publicada no', async () => {
    const id = await store.save(input(), { touchContent: true })
    await store.setStatus(id, 'published')
    expect(await store.remove(id)).toBe('published')
    expect((await pg.query(`select count(*)::int as n from guide_places`)).rows[0]).toEqual({ n: 4 })
    await store.setStatus(id, 'draft')
    expect(await store.remove(id)).toBe('deleted')
    expect(await store.get(id)).toBeNull()
    expect((await pg.query(`select count(*)::int as n from guide_places`)).rows[0]).toEqual({ n: 0 })
    // Los lugares de places no se tocan.
    expect((await pg.query(`select count(*)::int as n from places`)).rows[0]).toEqual({ n: 5 })
    expect(await store.remove(id)).toBe('not_found')
  })
})
