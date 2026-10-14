import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { candidatesQuery, openAtSql } from './candidates'
import { dishTarget } from './dishes'
import { montevideoNow, openStatus, resolveOpenAt, type Hours } from './hours'
import { openStateLabel } from './labels'

const lateBar: Hours = { status: 'exact', slots: [{ day: 5, opens: '20:00', closes: '02:00' }] }
const lunch: Hours = { status: 'exact', slots: [{ day: 1, opens: '12:00', closes: '16:00' }] }
const fromEvening: Hours = { status: 'partial', slots: [{ day: 2, opens: '19:30', closes: null }] }

describe('montevideoNow', () => {
  it('usa la hora de Montevideo (UTC-3)', () => {
    // Lunes 12/10/2026 02:30 UTC = domingo 11/10 23:30 en Montevideo.
    expect(montevideoNow(new Date('2026-10-12T02:30:00Z'))).toEqual({ day: 0, time: '23:30' })
    expect(montevideoNow(new Date('2026-10-12T15:05:00Z'))).toEqual({ day: 1, time: '12:05' })
  })

  it('resuelve openAt: ahora, un día y hoy a una hora', () => {
    const now = new Date('2026-10-12T15:05:00Z') // lunes 12:05
    expect(resolveOpenAt('now', now)).toEqual({ day: 1, time: '12:05' })
    expect(resolveOpenAt({ day: 0, time: null }, now)).toEqual({ day: 0, time: null })
    expect(resolveOpenAt({ day: null, time: '21:00' }, now)).toEqual({ day: 1, time: '21:00' })
    expect(resolveOpenAt(null, now)).toBeNull()
  })
})

describe('openStatus', () => {
  it('horario normal', () => {
    expect(openStatus(lunch, { day: 1, time: '13:00' })).toEqual({ state: 'open', closesAt: '16:00' })
    expect(openStatus(lunch, { day: 1, time: '16:00' })).toEqual({ state: 'closed' })
    expect(openStatus(lunch, { day: 1, time: '11:59' })).toEqual({ state: 'closed' })
  })

  it('horario que cruza la medianoche cuenta para el día siguiente', () => {
    expect(openStatus(lateBar, { day: 5, time: '23:00' })).toEqual({ state: 'open', closesAt: '02:00' })
    expect(openStatus(lateBar, { day: 6, time: '01:30' })).toEqual({ state: 'open', closesAt: '02:00' })
    expect(openStatus(lateBar, { day: 6, time: '02:00' })).toEqual({ state: 'closed' })
    expect(openStatus(lateBar, { day: 5, time: '01:30' })).toEqual({ state: 'closed' })
  })

  it('closes null: abierto desde que abre, sin hora de cierre', () => {
    expect(openStatus(fromEvening, { day: 2, time: '23:59' })).toEqual({ state: 'open', closesAt: null })
    expect(openStatus(fromEvening, { day: 2, time: '19:00' })).toEqual({ state: 'closed' })
  })

  it('sin horario o vago queda sin confirmar', () => {
    expect(openStatus({ status: 'none', slots: [] }, { day: 1, time: '12:00' })).toEqual({ state: 'unconfirmed' })
    expect(openStatus({ status: 'vague', slots: lunch.slots }, { day: 1, time: '12:00' })).toEqual({ state: 'unconfirmed' })
    expect(openStatus({ status: 'partial', slots: [] }, { day: 1, time: '12:00' })).toEqual({ state: 'unconfirmed' })
  })

  it('un día sin hora: abre ese día', () => {
    expect(openStatus(lateBar, { day: 5, time: null })).toEqual({ state: 'open', opensAt: '20:00', closesAt: '02:00' })
    expect(openStatus(lateBar, { day: 4, time: null })).toEqual({ state: 'closed' })
  })

  it('arma las etiquetas en español e inglés', () => {
    const open = openStatus(lateBar, { day: 5, time: '23:00' })
    expect(openStateLabel(open, 'es', { day: 5, time: '23:00' }, true)).toBe('Abierto · cierra 02:00')
    expect(openStateLabel(open, 'en', { day: 5, time: '23:00' }, true)).toBe('Open · closes 02:00')
    expect(openStateLabel({ state: 'unconfirmed' }, 'es', { day: 5, time: null }, false)).toBe('Horario no confirmado')
    expect(openStateLabel(openStatus(lateBar, { day: 5, time: null }), 'es', { day: 5, time: null }, false)).toBe('Viernes: abre 20:00–02:00')
  })
})

describe('SQL de candidatos', () => {
  const dialect = new PgDialect()

  it('openAt mira el día anterior para los horarios que cruzan la medianoche', () => {
    const query = dialect.sqlToQuery(openAtSql({ day: 0, time: '01:00' }))
    expect(query.params).toEqual([0, '01:00', '01:00', 6, '01:00'])
    expect(query.sql).toContain("hours->>'status' not in ('exact', 'partial')")
  })

  it('aplica sólo los filtros pedidos y pasa los arrays como parámetros', () => {
    const query = dialect.sqlToQuery(
      candidatesQuery(
        { categories: ['cafe'], tags: ['terrace'], diet: ['vegan'], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: ['pizza'], dishes: [dishTarget('milanesa napolitana')], dishMode: 'dish', near: null },
        { embedding: [0.1, 0.2], keywords: ['milanesa', 'napolitana'], name: 'cafe', origins: [], pinnedId: 'abc' },
      ),
    )
    expect(query.sql).toContain('categories && $')
    expect(query.sql).toContain('tags @> $')
    expect(query.sql).toContain('"diet_vegan" in (\'has_options\', \'fully\')')
    expect(query.sql).toContain('not (tags && $')
    expect(query.sql).toContain('f_unaccent(lower(name))')
    expect(query.sql).not.toContain('neighborhood_id = any')
    expect(query.sql).not.toContain('price = any')
    expect(query.params).toContainEqual(['cafe'])
    expect(query.params).toContainEqual(['milanesa'])
    expect(query.params).toContain('milanesa | napolitana')
    expect(query.params).toContain('abc')
  })

  it('manda el embedding una sola vez y redondeado a 5 decimales', () => {
    const query = dialect.sqlToQuery(
      candidatesQuery(
        { categories: [], tags: [], diet: [], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'dish', near: null },
        { embedding: [0.0123456789, -0.98765432, 1e-7], keywords: [], name: null, origins: [], pinnedId: null },
      ),
    )
    const vectors = query.params.filter((param) => typeof param === 'string' && param.startsWith('['))
    expect(vectors).toEqual(['[0.01235,-0.98765,0]'])
    expect(query.sql.match(/select v from query_vector/g)).toHaveLength(2)
  })

  it('cerca mío filtra por radio y mide la distancia desde la persona', () => {
    const point = { lat: -34.905, lng: -56.185 }
    const query = dialect.sqlToQuery(
      candidatesQuery(
        { categories: [], tags: [], diet: [], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'dish', near: { ...point, radiusM: 1500 } },
        { embedding: null, keywords: [], name: null, origins: [point], pinnedId: null },
      ),
    )
    expect(query.sql).toContain('ST_DWithin(location, ST_SetSRID(ST_MakePoint($')
    expect(query.sql).toContain('ST_Distance(location, ST_SetSRID(ST_MakePoint($')
    // ST_MakePoint(lng, lat): primero la longitud.
    expect(query.params.slice(0, 3)).toEqual([-56.185, -34.905, 1500])
  })
})
