import { describe, expect, it } from 'vitest'
import { placeOpenText } from '@/components/pages/PlacePage/utils/summary'
import { MINUTES_PER_WEEK, statusAt } from '@/lib/week-status'
import type { Hours } from '../../search/hours'
import { weekStatus } from '../status'

// Lunes a viernes 08:00–20:00, sábado 09:00–14:00 y un turno que cruza la medianoche el viernes (21:00–01:00).
const hours: Hours = {
  status: 'exact',
  slots: [
    ...[1, 2, 3, 4, 5].map((day) => ({ day, opens: '08:00', closes: '20:00' })),
    { day: 5, opens: '21:00', closes: '01:00' },
    { day: 6, opens: '09:00', closes: '14:00' },
  ],
}

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

describe('weekStatus', () => {
  it('cada minuto de la semana da el mismo texto que la ficha (placeOpenText)', () => {
    const week = weekStatus(hours)
    for (let minute = 0; minute < MINUTES_PER_WEEK; minute++) {
      const expected = placeOpenText(hours, null, { day: Math.floor(minute / 1440), time: clock(minute % 1440) })
      expect(statusAt(week, minute), `minuto ${minute}`).toEqual(expected)
    }
  })

  it('va comprimido: pocos tramos y textos sin repetir', () => {
    const week = weekStatus(hours)
    expect(week.at[0][0]).toBe(0)
    expect(week.at.length).toBeLessThan(80)
    expect(new Set(week.texts.map((text) => JSON.stringify(text))).size).toBe(week.texts.length)
    // Ningún tramo repite el índice del anterior.
    expect(week.at.every(([, text], i) => i === 0 || text !== week.at[i - 1][1])).toBe(true)
  })

  it('sin horario confirmado: un solo tramo sin estado', () => {
    expect(weekStatus({ slots: [], status: 'none' })).toEqual({ texts: [], at: [[0, -1]] })
  })
})
