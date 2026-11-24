import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  insertGoogleRefreshRunQuery,
  resolveGoogleFlagsQuery,
  staleCoordinatesQuery,
  upsertGoogleFlagQuery,
} from '../../src/data/google-flags.ts'
import type { Query } from '../../src/data/events.ts'
import { googleFlagsStore } from './store.ts'

// Postgres real en memoria (PGlite): una tabla places mínima (con el check de motivos que la 0031 recrea) y la
// migración 0031 tal cual. Prueba el SQL compartido que escribe el cron de la app y el que usa el backoffice.
const MIGRATION = readFileSync(path.resolve(import.meta.dirname, '../../drizzle/0031_google_refresh.sql'), 'utf8')
const PLACES = `create table places (
  id uuid primary key, name text not null, status text not null, review_reasons text[] not null default '{}',
  manual_overrides jsonb not null default '{}', coordinates_source text not null default 'google',
  coordinates_fetched_at timestamptz, updated_at timestamptz not null default '2026-01-01',
  constraint places_review_reasons_check check (true)
)`

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const NOW = new Date('2026-11-24T07:00:00Z')
const later = (days: number) => new Date(NOW.getTime() + days * 86400000)

let db: PGlite
const run = (query: Query) => db.query<Record<string, unknown>>(query.text, query.params).then((result) => result.rows)
const store = () => googleFlagsStore((text, params) => db.query<Record<string, unknown>>(text, params).then((result) => result.rows))
const flags = async () =>
  (await db.query<{ reason: string; ignored: boolean; resolved: boolean; distance_m: number | null; new_google_place_id: string | null }>(
    `select reason, ignored_at is not null as ignored, resolved_at is not null as resolved, distance_m, new_google_place_id
     from place_google_flags order by reason`
  )).rows

beforeEach(async () => {
  db = new PGlite()
  await db.exec(PLACES)
  for (const statement of MIGRATION.split('--> statement-breakpoint')) await db.exec(statement)
  await db.query(
    `insert into places (id, name, status, review_reasons, coordinates_fetched_at) values
     ($1, 'Lugar A', 'published', '{}', $3), ($2, 'Lugar B', 'published', '{low_rating}', null)`,
    [A, B, later(-40).toISOString()]
  )
})

describe('SQL compartido del cron', () => {
  it('abre un aviso una vez: repetirlo no cuenta, y si se resolvió se reabre', async () => {
    expect(await run(upsertGoogleFlagQuery(A, { reason: 'not_found' }, NOW))).toHaveLength(1)
    expect(await run(upsertGoogleFlagQuery(A, { reason: 'not_found' }, later(1)))).toHaveLength(0)
    await run(resolveGoogleFlagsQuery(A, ['not_found'], later(2)))
    expect(await flags()).toMatchObject([{ reason: 'not_found', resolved: true }])
    expect(await run(upsertGoogleFlagQuery(A, { reason: 'not_found' }, later(3)))).toHaveLength(1)
    expect(await flags()).toMatchObject([{ reason: 'not_found', resolved: false }])
  })

  it('uno ignorado sigue ignorado, salvo "se movió" (cada movimiento avisa) o un reemplazo por otro id', async () => {
    await run(upsertGoogleFlagQuery(A, { reason: 'not_found' }, NOW))
    await run(upsertGoogleFlagQuery(A, { reason: 'moved', distanceM: 150 }, NOW))
    await run(upsertGoogleFlagQuery(A, { reason: 'replaced', newGooglePlaceId: 'g1' }, NOW))
    await db.query(`update place_google_flags set ignored_at = now()`)

    expect(await run(upsertGoogleFlagQuery(A, { reason: 'not_found' }, later(1)))).toHaveLength(0)
    expect(await run(upsertGoogleFlagQuery(A, { reason: 'replaced', newGooglePlaceId: 'g1' }, later(1)))).toHaveLength(0)
    expect(await run(upsertGoogleFlagQuery(A, { reason: 'moved', distanceM: 300 }, later(1)))).toHaveLength(1)
    expect(await run(upsertGoogleFlagQuery(A, { reason: 'replaced', newGooglePlaceId: 'g2' }, later(1)))).toHaveLength(1)
    expect(await flags()).toEqual([
      { reason: 'moved', ignored: false, resolved: false, distance_m: 300, new_google_place_id: null },
      { reason: 'not_found', ignored: true, resolved: false, distance_m: null, new_google_place_id: null },
      { reason: 'replaced', ignored: false, resolved: false, distance_m: null, new_google_place_id: 'g2' },
    ])
  })

  it('el check de la base rechaza un motivo desconocido', async () => {
    await expect(db.query(`insert into place_google_flags (place_id, reason) values ($1, 'closed')`, [A])).rejects.toThrow()
  })

  it('atrasados: publicados de Google con más de 30 días o sin fecha', async () => {
    await db.query(`insert into places (id, name, status, coordinates_source, coordinates_fetched_at) values
      ('00000000-0000-4000-8000-0000000000c1', 'Fresco', 'published', 'google', $1),
      ('00000000-0000-4000-8000-0000000000c2', 'Manual', 'published', 'manual', null),
      ('00000000-0000-4000-8000-0000000000c3', 'Borrador', 'review', 'google', null)`, [later(-5).toISOString()])
    expect(await run(staleCoordinatesQuery(NOW))).toEqual([{ stale: 2 }])
  })

  it('guarda la corrida', async () => {
    const summary = { batchSize: 40, refreshed: 38, flagged: 1, failed: 1, stoppedReason: 'quota' as const, staleAfter: 12 }
    await run(insertGoogleRefreshRunQuery(NOW, later(0), summary))
    expect((await store().list(NOW)).lastRun).toEqual({ startedAt: NOW.toISOString(), refreshed: 38, flagged: 1, failed: 1, stoppedReason: 'quota' })
  })
})

describe('googleFlagsStore', () => {
  it('lista los abiertos de lugares publicados, con la cantidad de atrasados', async () => {
    await run(upsertGoogleFlagQuery(A, { reason: 'moved', distanceM: 150 }, NOW))
    await run(upsertGoogleFlagQuery(B, { reason: 'not_found' }, later(1)))
    const result = await store().list(NOW)
    expect(result.stale).toBe(2)
    expect(result.lastRun).toBeNull()
    expect(result.flags.map((flag) => [flag.placeName, flag.reason, flag.distanceM])).toEqual([
      ['Lugar B', 'not_found', null],
      ['Lugar A', 'moved', 150],
    ])
  })

  it('Ignorar lo saca de la lista; un aviso ya ignorado da false', async () => {
    const [flag] = await run(upsertGoogleFlagQuery(A, { reason: 'not_found' }, NOW))
    expect(await store().ignore(String(flag.id))).toBe(true)
    expect(await store().ignore(String(flag.id))).toBe(false)
    expect((await store().list(NOW)).flags).toEqual([])
  })

  it('Despublicar manda a "A revisar" con el motivo, lo fija a mano, cierra el aviso y no toca updated_at', async () => {
    const [flag] = await run(upsertGoogleFlagQuery(B, { reason: 'moved', distanceM: 150 }, NOW))
    expect(await store().unpublish(String(flag.id))).toBe('unpublished')
    const { rows } = await db.query<Record<string, unknown>>(`select status, review_reasons, manual_overrides, updated_at from places where id = $1`, [B])
    expect(rows[0]).toMatchObject({
      status: 'review',
      review_reasons: ['location_moved', 'low_rating'],
      manual_overrides: { status: 'review', review_reasons: ['location_moved', 'low_rating'] },
    })
    expect((rows[0].updated_at as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(await flags()).toMatchObject([{ reason: 'moved', resolved: true }])
    expect(await store().unpublish(String(flag.id))).toBe('not_found')
  })

  it('"no encontrado" y "reemplazado" despublican con not_found_in_google', async () => {
    const [flag] = await run(upsertGoogleFlagQuery(A, { reason: 'replaced', newGooglePlaceId: 'g1' }, NOW))
    await store().unpublish(String(flag.id))
    const { rows } = await db.query<{ review_reasons: string[] }>(`select review_reasons from places where id = $1`, [A])
    expect(rows[0].review_reasons).toEqual(['not_found_in_google'])
  })
})
