import { describe, expect, it } from 'vitest'
import { SEARCH_CONFIG } from '@/server/search/config'
import { montevideoMinuteOfWeek, MONTEVIDEO_TIME_ZONE, statusAt, type WeekStatus } from '../week-status'

const open = { tone: 'open', prefix: '', status: 'Abierto', detail: 'Cierra 20:00' } as const
const closed = { tone: 'closed', prefix: '', status: 'Cerrado', detail: 'Abre mañana 08:00' } as const
const week: WeekStatus = { texts: [closed, open], at: [[0, 0], [1920, 1], [2400, 0], [5000, -1]] }

describe('week-status', () => {
  it('la zona es la de la búsqueda', () => {
    expect(MONTEVIDEO_TIME_ZONE).toBe(SEARCH_CONFIG.timeZone)
  })

  it('minuto de la semana en hora de Montevideo (UTC−3), con domingo = 0', () => {
    // Jueves 19/11/2026 15:30 UTC = 12:30 en Montevideo.
    expect(montevideoMinuteOfWeek(new Date('2026-11-19T15:30:00Z'))).toBe(4 * 1440 + 12 * 60 + 30)
    // Domingo 02:00 UTC = sábado 23:00 en Montevideo.
    expect(montevideoMinuteOfWeek(new Date('2026-11-22T02:00:00Z'))).toBe(6 * 1440 + 23 * 60)
  })

  it('elige el tramo que vale en ese minuto; -1 es sin estado', () => {
    expect(statusAt(week, 0)).toEqual(closed)
    expect(statusAt(week, 1919)).toEqual(closed)
    expect(statusAt(week, 1920)).toEqual(open)
    expect(statusAt(week, 2399)).toEqual(open)
    expect(statusAt(week, 2400)).toEqual(closed)
    expect(statusAt(week, 6000)).toBeNull()
    expect(statusAt({ texts: [], at: [] }, 10)).toBeNull()
  })
})
