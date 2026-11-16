import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  deleteOldEventsQuery,
  deleteOldSaltsQuery,
  insertEventQuery,
  readSaltQuery,
  summarizeQuery,
  upsertSaltQuery,
  type EventInput,
  type Query,
} from '../../src/data/events.ts'
import { popularityQuery } from './queries.ts'

// Postgres real en memoria (PGlite), sin Neon: una tabla places mínima (lo que la 0025 necesita para la clave foránea y
// el filtro de publicados) y sólo la migración 0025. Las anteriores usan PostGIS y pgvector y no se replican.
const MIGRATION = readFileSync(path.resolve(import.meta.dirname, '../../drizzle/0025_place_events.sql'), 'utf8')

const PUBLISHED = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const DRAFT = '00000000-0000-4000-8000-000000000003'

let db: PGlite

const run = (query: Query) => db.query(query.text, query.params)

async function events(where = 'true') {
  const result = await db.query<{ type: string; visitor: string; day: string; origin: string; origin_row: string | null }>(
    `select type, visitor, to_char(day, 'YYYY-MM-DD') as day, origin, origin_row from place_events where ${where} order by id`
  )
  return result.rows
}

async function daily() {
  const result = await db.query<{ place_id: string; type: string; day: string; total: number }>(
    `select place_id, type, to_char(day, 'YYYY-MM-DD') as day, total from place_event_daily order by place_id, type, day`
  )
  return result.rows
}

const event = (overrides: Partial<EventInput> = {}): EventInput => ({
  placeId: PUBLISHED,
  type: 'view',
  visitor: 'a'.repeat(32),
  day: '2026-11-15',
  origin: 'search',
  originRow: null,
  ...overrides,
})

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`create table places (id uuid primary key, name text not null, slug text not null, status text not null);
    insert into places values
      ('${PUBLISHED}', 'Café Uno', 'cafe-uno', 'published'),
      ('${OTHER}', 'Bar Dos', 'bar-dos', 'published'),
      ('${DRAFT}', 'Borrador', 'borrador', 'draft');`)
  await db.exec(MIGRATION)
})

describe('place_events: una vez por persona, lugar, tipo y día', () => {
  it('la restricción única la garantiza la base: un insert directo repetido falla', async () => {
    const insert = `insert into place_events (place_id, type, visitor, day, origin) values ('${PUBLISHED}', 'view', 'x', '2026-11-15', 'direct')`
    await db.exec(insert)
    await expect(db.exec(insert)).rejects.toThrow(/place_events_once_per_day/)
  })

  it('la misma vista dos veces el mismo día queda una; gana el primer origen', async () => {
    await run(insertEventQuery(event({ origin: 'home', originRow: 'breakfast' })))
    await run(insertEventQuery(event({ origin: 'search' })))
    expect(await events()).toEqual([{ type: 'view', visitor: 'a'.repeat(32), day: '2026-11-15', origin: 'home', origin_row: 'breakfast' }])
  })

  it('otro día, otro visitante, otro lugar u otro tipo cuentan aparte', async () => {
    await run(insertEventQuery(event()))
    await run(insertEventQuery(event({ day: '2026-11-16' })))
    await run(insertEventQuery(event({ visitor: 'b'.repeat(32) })))
    await run(insertEventQuery(event({ placeId: OTHER })))
    await run(insertEventQuery(event({ type: 'directions' })))
    expect(await events()).toHaveLength(5)
  })

  it('un lugar no publicado o inexistente no se guarda', async () => {
    await run(insertEventQuery(event({ placeId: DRAFT })))
    await run(insertEventQuery(event({ placeId: '00000000-0000-4000-8000-000000000099' })))
    expect(await events()).toEqual([])
  })

  it('los checks rechazan tipos y orígenes fuera del catálogo', async () => {
    await expect(run(insertEventQuery(event({ type: 'like' as never })))).rejects.toThrow(/place_events_type_check/)
    await expect(run(insertEventQuery(event({ origin: 'ads' as never })))).rejects.toThrow(/place_events_origin_check/)
  })
})

describe('guardar y sacar', () => {
  it('guardar y sacar el mismo día deja cero filas (y el resumen en cero)', async () => {
    await run(insertEventQuery(event({ type: 'save' })))
    await run(insertEventQuery(event({ type: 'unsave' })))
    expect(await events()).toEqual([])
    await run(summarizeQuery('2026-11-15', '2026-11-16'))
    expect(await daily()).toEqual([])
  })

  it('guardar, sacar y volver a guardar el mismo día queda en un guardado', async () => {
    await run(insertEventQuery(event({ type: 'save' })))
    await run(insertEventQuery(event({ type: 'unsave' })))
    await run(insertEventQuery(event({ type: 'save' })))
    expect((await events()).map((row) => row.type)).toEqual(['save'])
  })

  it('sacar hoy algo guardado otro día resta uno en el neto de hoy; el total de los dos días es cero', async () => {
    await run(insertEventQuery(event({ type: 'save', day: '2026-11-14', visitor: 'y'.repeat(32) })))
    // Otro día, otra clave: el código del visitante es otro.
    await run(insertEventQuery(event({ type: 'unsave', day: '2026-11-15', visitor: 'z'.repeat(32) })))
    await run(summarizeQuery('2026-11-14', '2026-11-16'))
    expect(await daily()).toEqual([
      { place_id: PUBLISHED, type: 'save', day: '2026-11-14', total: 1 },
      { place_id: PUBLISHED, type: 'save', day: '2026-11-15', total: -1 },
    ])
  })

  it('sacar y volver a guardar el mismo día (estaba guardado de antes) queda en cero hoy', async () => {
    await run(insertEventQuery(event({ type: 'unsave' })))
    await run(insertEventQuery(event({ type: 'save' })))
    expect(await events()).toEqual([])
  })

  it('sacar no cancela el guardado de otro visitante', async () => {
    await run(insertEventQuery(event({ type: 'save', visitor: 'b'.repeat(32) })))
    await run(insertEventQuery(event({ type: 'unsave' })))
    expect((await events()).map((row) => [row.type, row.visitor[0]])).toEqual([['save', 'b'], ['unsave', 'a']])
  })
})

describe('límite por código por minuto', () => {
  it('pasado el límite no guarda más; otro código sí', async () => {
    const limit = 2
    await run(insertEventQuery(event({ type: 'view' }), limit))
    await run(insertEventQuery(event({ type: 'directions' }), limit))
    await run(insertEventQuery(event({ type: 'save' }), limit))
    expect((await events()).map((row) => row.type)).toEqual(['view', 'directions'])
    await run(insertEventQuery(event({ type: 'save', visitor: 'b'.repeat(32) }), limit))
    expect(await events(`type = 'save'`)).toHaveLength(1)
  })

  it('pasado el minuto vuelve a guardar', async () => {
    const limit = 1
    await run(insertEventQuery(event({ type: 'view' }), limit))
    await run(insertEventQuery(event({ type: 'directions' }), limit))
    expect(await events()).toHaveLength(1)
    await db.exec(`update place_events set created_at = now() - interval '61 seconds'`)
    await run(insertEventQuery(event({ type: 'directions' }), limit))
    expect(await events()).toHaveLength(2)
  })
})

describe('clave del día', () => {
  it('la primera vez la crea; después devuelve la misma aunque se proponga otra', async () => {
    const first = await run(upsertSaltQuery('2026-11-15', 'ab'.repeat(32)))
    const second = await run(upsertSaltQuery('2026-11-15', 'cd'.repeat(32)))
    expect(first.rows).toEqual([{ salt: 'ab'.repeat(32) }])
    expect(second.rows).toEqual([{ salt: 'ab'.repeat(32) }])
    expect((await run(readSaltQuery('2026-11-15'))).rows).toEqual([{ salt: 'ab'.repeat(32) }])
  })
})

describe('cron: resumen y limpieza', () => {
  it('suma por lugar, tipo y día, es idempotente y no toca hoy', async () => {
    for (const visitor of ['a', 'b', 'c']) await run(insertEventQuery(event({ day: '2026-11-14', visitor: visitor.repeat(32) })))
    await run(insertEventQuery(event({ day: '2026-11-14', type: 'directions' })))
    await run(insertEventQuery(event({ day: '2026-11-15' })))
    await run(summarizeQuery('2026-11-12', '2026-11-15'))
    await run(summarizeQuery('2026-11-12', '2026-11-15'))
    expect(await daily()).toEqual([
      { place_id: PUBLISHED, type: 'directions', day: '2026-11-14', total: 1 },
      { place_id: PUBLISHED, type: 'view', day: '2026-11-14', total: 3 },
    ])
  })

  it('borra los eventos de más de 90 días y las claves de días anteriores; el resumen queda', async () => {
    await run(insertEventQuery(event({ day: '2026-08-16' })))
    await run(insertEventQuery(event({ day: '2026-08-17' })))
    await run(summarizeQuery('2026-08-16', '2026-08-18'))
    await run(upsertSaltQuery('2026-11-14', 'ab'.repeat(32)))
    await run(upsertSaltQuery('2026-11-15', 'cd'.repeat(32)))

    await run(deleteOldEventsQuery('2026-08-17'))
    await run(deleteOldSaltsQuery('2026-11-15'))

    expect((await events()).map((row) => row.day)).toEqual(['2026-08-17'])
    expect((await db.query(`select to_char(day, 'YYYY-MM-DD') as day from event_salts`)).rows).toEqual([{ day: '2026-11-15' }])
    expect(await daily()).toHaveLength(2)
  })

  it('borrar un lugar borra sus eventos y su resumen (cascade)', async () => {
    await run(insertEventQuery(event({ day: '2026-11-14' })))
    await run(summarizeQuery('2026-11-14', '2026-11-15'))
    await db.exec(`delete from places where id = '${PUBLISHED}'`)
    expect(await events()).toEqual([])
    expect(await daily()).toEqual([])
  })
})

describe('vista de popularidad del backoffice', () => {
  it('totales de 7 y 30 días por tipo (hasta ayer) y origen de las vistas', async () => {
    // Hoy 2026-11-15: 7 días = 11-08…11-14; 30 días = 10-16…11-14.
    await run(insertEventQuery(event({ day: '2026-11-14', origin: 'home', originRow: 'breakfast' })))
    await run(insertEventQuery(event({ day: '2026-11-14', visitor: 'b'.repeat(32), origin: 'search' })))
    await run(insertEventQuery(event({ day: '2026-11-01', origin: 'home', originRow: 'breakfast' })))
    await run(insertEventQuery(event({ day: '2026-11-01', visitor: 'c'.repeat(32), origin: 'similar' })))
    await run(insertEventQuery(event({ day: '2026-11-01', type: 'save' })))
    await run(insertEventQuery(event({ day: '2026-11-10', type: 'directions' })))
    await run(insertEventQuery(event({ day: '2026-10-01' }))) // fuera de los 30 días
    await run(insertEventQuery(event({ day: '2026-11-15' }))) // hoy: todavía no está en el resumen
    await run(summarizeQuery('2026-09-01', '2026-11-15'))

    const query = popularityQuery('2026-11-15')
    const { rows } = await db.query(query.text, query.params)
    expect(rows).toEqual([
      {
        id: PUBLISHED,
        name: 'Café Uno',
        slug: 'cafe-uno',
        views7: 2,
        views30: 4,
        saves7: 0,
        saves30: 1,
        directions7: 1,
        directions30: 1,
        origins: { home: 2, search: 1, similar: 1 },
        homeRows: [{ row: 'breakfast', count: 2 }],
      },
    ])
  })
})
