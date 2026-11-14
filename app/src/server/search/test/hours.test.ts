import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { candidatesQuery, openAtSql, openFilterSql, openWindowSql } from '../candidates'
import { dishTarget } from '../dishes'
import { matchesOpenFilter, montevideoNow, nextOpening, openStatus, opensToday, resolveOpenAt, type Hours } from '../hours'
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

  it('resuelve openAt: abierto ahora, hoy, esta noche, hoy al mediodía, un día y hoy a una hora', () => {
    const now = new Date('2026-10-12T15:05:00Z') // lunes 12:05
    const moment = { day: 1, time: '12:05' }
    expect(resolveOpenAt('now', now)).toEqual({ kind: 'now', moment, confirmed: true })
    expect(resolveOpenAt('today', now)).toEqual({ kind: 'window', moment, from: '12:05', until: null, night: false, confirmed: true })
    // Esta noche: desde las 19:00 (o ahora, si ya es más tarde).
    expect(resolveOpenAt('tonight', now)).toEqual({ kind: 'window', moment, from: '19:00', until: null, night: true, confirmed: true })
    expect(resolveOpenAt('tonight', new Date('2026-10-13T01:30:00Z'))).toMatchObject({ from: '22:30' })
    // Hoy al mediodía: desde las 11:00 (o ahora) hasta las 15:00.
    expect(resolveOpenAt('midday', now)).toEqual({ kind: 'window', moment, from: '12:05', until: '15:00', night: false, confirmed: true })
    expect(resolveOpenAt('midday', new Date('2026-10-12T12:00:00Z'))).toMatchObject({ from: '11:00', until: '15:00' })
    expect(resolveOpenAt({ day: 0, time: null }, now)).toEqual({ kind: 'at', moment: { day: 0, time: null }, confirmed: false })
    expect(resolveOpenAt({ day: null, time: '21:00' }, now)).toEqual({ kind: 'at', moment: { day: 1, time: '21:00' }, confirmed: false })
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
    expect(openStateLabel({ state: 'unconfirmed' }, 'es', { day: 5, time: null }, false)).toBe('Horario sin confirmar')
    expect(openStateLabel(openStatus(lateBar, { day: 5, time: null }), 'es', { day: 5, time: null }, false)).toBe('Viernes: abre 20:00–02:00')
  })
})

describe('horario cargado a mano en el backoffice', () => {
  it('se lee igual que uno del pipeline: los campos de más (source manual, display, raw) no cambian nada', () => {
    const manual = { ...lateBar, source: 'manual', missingReason: null, raw: 'Viernes: 20:00–02:00', display: { es: 'Viernes: 20:00–02:00', en: 'Friday: 20:00–02:00' } } as Hours
    for (const at of [{ day: 5, time: '23:00' }, { day: 6, time: '01:30' }, { day: 6, time: '02:00' }, { day: 5, time: '19:00' }]) {
      expect(openStatus(manual, at)).toEqual(openStatus(lateBar, at))
      expect(opensToday(manual, at)).toEqual(opensToday(lateBar, at))
    }
    expect(openStateLabel(openStatus(manual, { day: 5, time: '23:00' }), 'es', { day: 5, time: '23:00' }, true)).toBe('Abierto · cierra 02:00')
    expect(opensToday(manual, { day: 5, time: '19:00' })).toBe('yes')
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

describe('opensToday', () => {
  // Lunes 12:00–16:00 y 20:00–23:30; martes 20:00–02:00 (cruza la medianoche).
  const hours: Hours = {
    status: 'exact',
    slots: [
      { day: 1, opens: '12:00', closes: '16:00' },
      { day: 1, opens: '20:00', closes: '23:30' },
      { day: 2, opens: '20:00', closes: '02:00' },
    ],
  }

  it('abierto ahora', () => {
    expect(opensToday(hours, { day: 1, time: '13:00' })).toBe('yes')
  })

  it('abre más tarde hoy (cerrado entre turnos o antes del primero)', () => {
    expect(opensToday(hours, { day: 1, time: '17:00' })).toBe('yes')
    expect(opensToday(hours, { day: 1, time: '09:00' })).toBe('yes')
  })

  it('ya cerró por hoy', () => {
    expect(opensToday(hours, { day: 1, time: '23:45' })).toBe('no')
  })

  it('cerrado hoy: no tiene turno ese día', () => {
    expect(opensToday(hours, { day: 4, time: '10:00' })).toBe('no')
  })

  it('madrugada: el turno de ayer que cruza la medianoche sigue abierto', () => {
    // Miércoles 01:00, con el martes 20:00–02:00; el miércoles no tiene turno propio.
    expect(opensToday(hours, { day: 3, time: '01:00' })).toBe('yes')
    expect(opensToday(hours, { day: 3, time: '02:30' })).toBe('no')
  })

  describe('a la noche (cenar o "esta noche")', () => {
    const at = (time: string) => ({ day: 1, time })
    const lunchOnly: Hours = { status: 'exact', slots: [{ day: 1, opens: '12:00', closes: '15:00' }] }
    const allDay: Hours = { status: 'exact', slots: [{ day: 1, opens: '12:00', closes: '01:00' }] }
    const fromSix: Hours = { status: 'partial', slots: [{ day: 1, opens: '18:00', closes: null }] }

    it('un lugar que sólo abre al mediodía no sirve, aunque esté abierto ahora', () => {
      expect(opensToday(lunchOnly, at('13:00'))).toBe('yes')
      expect(opensToday(lunchOnly, at('13:00'), true)).toBe('no')
    })

    it('sirve si está abierto desde las 20 o abre a la noche', () => {
      expect(opensToday(allDay, at('13:00'), true)).toBe('yes')
      expect(opensToday(fromSix, at('13:00'), true)).toBe('yes')
      expect(opensToday(hours, at('13:00'), true)).toBe('yes') // turno 20:00–23:30
    })

    it('ya de noche cuenta desde ahora', () => {
      expect(opensToday(hours, at('23:00'), true)).toBe('yes')
      expect(opensToday(hours, at('23:45'), true)).toBe('no')
    })

    it('en la madrugada sigue la noche anterior; un turno del mediodía no cuenta', () => {
      const withLunch: Hours = { status: 'exact', slots: [...hours.slots, { day: 3, opens: '12:00', closes: '15:00' }] }
      expect(opensToday(withLunch, { day: 3, time: '01:00' }, true)).toBe('yes') // martes 20:00–02:00
      expect(opensToday(withLunch, { day: 3, time: '02:30' }, true)).toBe('no')
      expect(opensToday(withLunch, { day: 3, time: '02:30' })).toBe('yes') // sin noche, el mediodía sí
    })
  })

  it('sin horario confiable no se sabe', () => {
    expect(opensToday({ status: 'none', slots: [] }, { day: 1, time: '13:00' })).toBe('unconfirmed')
    expect(opensToday({ status: 'vague', slots: hours.slots }, { day: 1, time: '13:00' })).toBe('unconfirmed')
  })
})

describe('SQL de candidatos', () => {
  const dialect = new PgDialect()

  it('openAt mira el día anterior para los horarios que cruzan la medianoche; un día/hora deja pasar los sin confirmar', () => {
    const query = dialect.sqlToQuery(openAtSql({ day: 0, time: '01:00' }))
    expect(query.params).toEqual([0, '01:00', '01:00', 6, '01:00'])
    expect(query.sql).toContain("jsonb_array_length(hours->'slots') = 0) or exists")
  })

  it('"Abierto ahora": abierto en ese momento y sólo con horario confirmado', () => {
    const query = dialect.sqlToQuery(openFilterSql({ kind: 'now', moment: { day: 0, time: '01:00' }, confirmed: true }))
    expect(query.params).toEqual([0, '01:00', '01:00', 6, '01:00'])
    expect(query.sql).toContain("(false or exists")
    expect(query.sql).toContain("and not (hours->>'status' not in ('exact', 'partial')")
  })

  it('hoy: abierto ahora o un turno de hoy que abre más tarde, sin los de horario sin confirmar', () => {
    const query = dialect.sqlToQuery(openWindowSql(3, { from: '01:00', until: null, night: false }))
    expect(query.params).toEqual([3, '01:00', '01:00', 2, '01:00', 3, '01:00'])
    expect(query.sql).toContain("s->>'opens' >")
    expect(query.sql).toContain("not (hours->>'status' not in ('exact', 'partial')")
  })

  it('esta noche: desde las 19 y sólo turnos que llegan a la noche', () => {
    const query = dialect.sqlToQuery(openWindowSql(1, { from: '19:00', until: null, night: true }))
    expect(query.params).toEqual([1, '19:00', '19:00', 0, '19:00', 1, '19:00', '19:00'])
  })

  it('hoy al mediodía: turnos que abren antes de las 15; pasada la ventana, nada', () => {
    const query = dialect.sqlToQuery(openWindowSql(1, { from: '11:00', until: '15:00', night: false }))
    expect(query.params).toEqual([1, '11:00', '11:00', 0, '11:00', 1, '11:00', '15:00'])
    expect(dialect.sqlToQuery(openWindowSql(1, { from: '15:30', until: '15:00', night: false })).sql).toBe('false')
  })

  it('la regla de una sección puede pedir íconos', () => {
    const query = dialect.sqlToQuery(
      candidatesQuery(
        { categories: [], tags: [], diet: [], neighborhoods: [], venues: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'dish', near: null, groups: [{ categories: ['grill'], icons: ['grill', 'meat'] }] },
        { embedding: null, keywords: [], name: null, origins: [], pinnedId: null },
      ),
    )
    expect(query.sql).toContain('icon_category = any($')
    expect(query.params).toContainEqual(['grill', 'meat'])
  })

  it('aplica sólo los filtros pedidos y pasa los arrays como parámetros', () => {
    const query = dialect.sqlToQuery(
      candidatesQuery(
        { categories: ['cafe'], tags: ['terrace'], diet: ['vegan'], neighborhoods: [], venues: [], price: [], openAt: null, excludeCategories: [], excludeTags: ['pizza'], excludeIcons: [], dishes: [dishTarget('milanesa napolitana')], dishMode: 'dish', near: null, groups: [] },
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
        { categories: [], tags: [], diet: [], neighborhoods: [], venues: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'dish', near: null, groups: [] },
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
        { categories: [], tags: [], diet: [], neighborhoods: [], venues: [], price: [], openAt: null, excludeCategories: [], excludeTags: [], excludeIcons: [], dishes: [], dishMode: 'dish', near: { ...point, radiusM: 1500 }, groups: [] },
        { embedding: null, keywords: [], name: null, origins: [point], pinnedId: null },
      ),
    )
    expect(query.sql).toContain('ST_DWithin(location, ST_SetSRID(ST_MakePoint($')
    expect(query.sql).toContain('ST_Distance(location, ST_SetSRID(ST_MakePoint($')
    // ST_MakePoint(lng, lat): primero la longitud.
    expect(query.params.slice(0, 3)).toEqual([-56.185, -34.905, 1500])
  })
})

describe('ventanas de hoy (opensWithin / matchesOpenFilter)', () => {
  // Lunes: uno sólo al mediodía (12–15), uno de noche (20–01), uno de tarde (16–19:30) y uno sin horario.
  const midday: Hours = { status: 'exact', slots: [{ day: 1, opens: '12:00', closes: '15:00' }] }
  const night: Hours = { status: 'exact', slots: [{ day: 1, opens: '20:00', closes: '01:00' }] }
  const afternoon: Hours = { status: 'exact', slots: [{ day: 1, opens: '16:00', closes: '19:30' }] }
  const unknown: Hours = { status: 'none', slots: [] }
  const at = (time: string) => new Date(`2026-10-12T${time}:00-03:00`)
  const matches = (hours: Hours, openAt: 'now' | 'today' | 'tonight' | 'midday', time: string) => matchesOpenFilter(hours, resolveOpenAt(openAt, at(time))!)

  it('esta noche a las 14:00: los que abren a la noche, no el del mediodía', () => {
    expect(matches(night, 'tonight', '14:00')).toBe('yes')
    expect(matches(midday, 'tonight', '14:00')).toBe('no')
    // Abierto a las 19:00 (cierra 19:30): llega a la noche.
    expect(matches(afternoon, 'tonight', '14:00')).toBe('yes')
  })

  it('esta noche a las 19:30 y a las 22:30: no trae los que ya cerraron', () => {
    expect(matches(afternoon, 'tonight', '19:30')).toBe('no')
    expect(matches(night, 'tonight', '22:30')).toBe('yes')
    expect(matches(afternoon, 'tonight', '22:30')).toBe('no')
  })

  it('esta noche a la 01:00 del martes: sigue la noche del lunes (abierto ahora)', () => {
    const lateNow = matchesOpenFilter(night, resolveOpenAt('tonight', new Date('2026-10-13T00:30:00-03:00'))!)
    expect(lateNow).toBe('yes')
  })

  it('hoy al mediodía: a las 10:00 y 13:00 sí; a las 15:30 ya no', () => {
    expect(matches(midday, 'midday', '10:00')).toBe('yes')
    expect(matches(midday, 'midday', '13:00')).toBe('yes')
    expect(matches(midday, 'midday', '15:30')).toBe('no')
    expect(matches(night, 'midday', '10:00')).toBe('no')
  })

  it('hoy: abierto ahora o abre más tarde; abierto ahora: sólo los abiertos', () => {
    expect(matches(night, 'today', '13:00')).toBe('yes')
    expect(matches(midday, 'today', '16:00')).toBe('no')
    expect(matches(midday, 'now', '13:00')).toBe('yes')
    expect(matches(night, 'now', '13:00')).toBe('no')
  })

  it('sin horario confirmado no se sabe (la búsqueda los saca con estos cuatro)', () => {
    for (const openAt of ['now', 'today', 'tonight', 'midday'] as const) expect(matches(unknown, openAt, '13:00')).toBe('unconfirmed')
  })
})
