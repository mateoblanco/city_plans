import { describe, expect, it } from 'vitest'
import { parseDevNow } from '../dev-now'

describe('?now= de la home', () => {
  const today = new Date('2026-10-12T16:00:00Z')

  it('en producción (o en test) se ignora', () => {
    expect(parseDevNow('2026-11-14T20:30', 'production')).toBeNull()
    expect(parseDevNow('20:30', 'test')).toBeNull()
    expect(parseDevNow('2026-11-14T20:30', undefined)).toBeNull()
  })

  it('en desarrollo: fecha y hora, o sólo la hora (hoy), en hora de Montevideo', () => {
    expect(parseDevNow('2026-11-14T20:30', 'development')?.toISOString()).toBe('2026-11-14T23:30:00.000Z')
    expect(parseDevNow('08:15', 'development', today)?.toISOString()).toBe('2026-10-12T11:15:00.000Z')
    expect(parseDevNow('T08:15', 'development', today)?.toISOString()).toBe('2026-10-12T11:15:00.000Z')
  })

  it('valores inválidos: la hora real', () => {
    for (const raw of ['25:00', 'mañana', '', undefined, ['20:30']]) expect(parseDevNow(raw, 'development')).toBeNull()
  })
})
