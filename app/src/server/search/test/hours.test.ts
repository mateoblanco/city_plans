import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { candidatesQuery, openAtSql } from '../candidates'
import { dishTarget } from '../dishes'
import { montevideoNow, nextOpening, openStatus, resolveOpenAt, type Hours } from '../hours'
import { openStateLabel, openStateText } from '../labels'

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

describe('nextOpening', () => {
  const label = (hours: Hours, at: { day: number; time: string }, lang: 'es' | 'en' = 'es') =>
    openStateLabel(openStatus(hours, at), lang, at, true, nextOpening(hours, at))

  it('horario que cruza la medianoche', () => {
    // Viernes 20:00–02:00.
    expect(nextOpening(lateBar, { day: 5, time: '15:00' })).toEqual({ daysAhead: 0, day: 5, opens: '20:00' })
    expect(label(lateBar, { day: 5, time: '15:00' })).toBe('Cerrado · Abre 20:00')
    expect(label(lateBar, { day: 4, time: '22:00' })).toBe('Cerrado · Abre mañana 20:00')
    // Sábado 03:00, ya cerró el turno del viernes: vuelve a abrir el viernes siguiente.
    expect(label(lateBar, { day: 6, time: '03:00' })).toBe('Cerrado · Abre el viernes 20:00')
    expect(label(lateBar, { day: 6, time: '03:00' }, 'en')).toBe('Closed · Opens Friday 20:00')
    // Abierto a la 01:30 del sábado: no hay próxima apertura que mostrar, y cierra en media hora.
    expect(label(lateBar, { day: 6, time: '01:30' })).toBe('Cierra pronto · 2:00')
  })

  it('cierra pronto y abre pronto: dentro de soonMinutes, sólo ahora', () => {
    const text = (hours: Hours, at: { day: number; time: string }, isNow = true) =>
      openStateText(openStatus(hours, at), 'es', at, isNow, isNow ? nextOpening(hours, at) : null)
    expect(text(lunch, { day: 1, time: '15:00' })).toEqual({ tone: 'closing_soon', prefix: '', status: 'Cierra pronto', detail: '16:00' })
    expect(text(lunch, { day: 1, time: '14:59' })).toMatchObject({ tone: 'open', status: 'Abierto', detail: 'cierra 16:00' })
    expect(text(lunch, { day: 1, time: '11:00' })).toEqual({ tone: 'opening_soon', prefix: '', status: 'Abre pronto', detail: '12:00' })
    expect(text(lunch, { day: 1, time: '10:59' })).toMatchObject({ tone: 'closed', status: 'Cerrado', detail: 'Abre 12:00' })
    // Cruzando la medianoche: viernes 23:30 con apertura el sábado 00:15.
    const night: Hours = { status: 'exact', slots: [{ day: 6, opens: '00:15', closes: '05:00' }] }
    expect(text(night, { day: 5, time: '23:30' })).toMatchObject({ tone: 'opening_soon', detail: '0:15' })
    expect(text(lateBar, { day: 6, time: '01:30' })).toMatchObject({ tone: 'closing_soon', detail: '2:00' })
    // Un momento pedido (no ahora) no dice "pronto".
    expect(text(lunch, { day: 1, time: '15:00' }, false)).toEqual({ tone: 'open', prefix: 'Lunes 15:00: ', status: 'abierto', detail: 'cierra 16:00' })
    expect(openStateText(openStatus(lunch, { day: 1, time: '15:00' }), 'en', { day: 1, time: '15:00' }, true).status).toBe('Closing soon')
  })

  it('local que no abre ningún día: queda "Cerrado"', () => {
    const never: Hours = { status: 'exact', slots: [] }
    expect(nextOpening(never, { day: 1, time: '12:00' })).toBeNull()
    expect(openStateLabel({ state: 'closed' }, 'es', { day: 1, time: '12:00' }, true, null)).toBe('Cerrado')
    expect(openStateLabel({ state: 'closed' }, 'en', { day: 1, time: '12:00' }, true, null)).toBe('Closed')
  })

  it('día con dos turnos: después del mediodía abre a la tarde', () => {
    const split: Hours = {
      status: 'exact',
      slots: [
        { day: 1, opens: '19:00', closes: '23:00' },
        { day: 1, opens: '12:00', closes: '15:00' },
        { day: 2, opens: '09:00', closes: '15:00' },
      ],
    }
    expect(label(split, { day: 1, time: '10:00' })).toBe('Cerrado · Abre 12:00')
    expect(label(split, { day: 1, time: '16:00' })).toBe('Cerrado · Abre 19:00')
    expect(label(split, { day: 1, time: '16:00' }, 'en')).toBe('Closed · Opens 19:00')
    // Sin cero adelante.
    expect(label(split, { day: 1, time: '23:30' })).toBe('Cerrado · Abre mañana 9:00')
    expect(label(split, { day: 1, time: '23:30' }, 'en')).toBe('Closed · Opens tomorrow 9:00')
  })

  it('sin horario confiable no calcula; un día pedido sigue sin próxima apertura', () => {
    expect(nextOpening({ status: 'vague', slots: lunch.slots }, { day: 0, time: '12:00' })).toBeNull()
    expect(openStateLabel({ state: 'closed' }, 'es', { day: 4, time: '21:00' }, false, { daysAhead: 1, day: 5, opens: '20:00' })).toBe('Jueves 21:00: cerrado')
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
        { categories: ['cafe'], tags: ['terrace'], diet: ['vegan'], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: ['pizza'], dishes: [dishTarget('milanesa napolitana')], dishMode: 'dish', near: null, groups: [] },
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
        { categories: [], tags: [], diet: [], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'dish', near: null, groups: [] },
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
        { categories: [], tags: [], diet: [], neighborhoods: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], dishes: [], dishMode: 'dish', near: { ...point, radiusM: 1500 }, groups: [] },
        { embedding: null, keywords: [], name: null, origins: [point], pinnedId: null },
      ),
    )
    expect(query.sql).toContain('ST_DWithin(location, ST_SetSRID(ST_MakePoint($')
    expect(query.sql).toContain('ST_Distance(location, ST_SetSRID(ST_MakePoint($')
    // ST_MakePoint(lng, lat): primero la longitud.
    expect(query.params.slice(0, 3)).toEqual([-56.185, -34.905, 1500])
  })
})
