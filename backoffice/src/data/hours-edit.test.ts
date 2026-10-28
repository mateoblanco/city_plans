import { describe, expect, it } from 'vitest'
import { crossesMidnight, hoursSlotIssues, ManualHours, sortedSlots } from './hours-edit.ts'

const messages = (slots: Parameters<typeof hoursSlotIssues>[0]) => hoursSlotIssues(slots).map((issue) => issue.message)

describe('hoursSlotIssues', () => {
  it('un turno que cruza la medianoche es válido y ocupa hasta las 24:00 de su día', () => {
    expect(messages([{ day: 5, opens: '20:00', closes: '02:00' }])).toEqual([])
    expect(crossesMidnight({ opens: '20:00', closes: '02:00' })).toBe(true)
    expect(messages([{ day: 5, opens: '20:00', closes: '02:00' }, { day: 5, opens: '23:00', closes: '23:30' }])).toEqual(['Hay turnos superpuestos.'])
    // El de la madrugada del día siguiente es de otro día: no se superpone.
    expect(messages([{ day: 5, opens: '20:00', closes: '02:00' }, { day: 6, opens: '00:30', closes: '04:00' }])).toEqual([])
  })

  it('cierre igual a la apertura, turnos superpuestos, horas inválidas y sin turnos', () => {
    expect(messages([{ day: 1, opens: '12:00', closes: '12:00' }])).toEqual(['El turno de las 12:00 cierra a la misma hora en que abre.'])
    expect(messages([{ day: 1, opens: '12:00', closes: '16:00' }, { day: 1, opens: '15:00', closes: '18:00' }])).toEqual(['Hay turnos superpuestos.'])
    expect(messages([{ day: 1, opens: '12:00', closes: '16:00' }, { day: 1, opens: '16:00', closes: '18:00' }])).toEqual([])
    expect(messages([{ day: 1, opens: '', closes: '16:00' }])).toEqual(['Completá la hora de apertura y de cierre (HH:MM).'])
    expect(messages([])).toEqual(['Cargá al menos un turno.'])
  })

  it('el schema rechaza lo inválido y sortedSlots ordena y saca repetidos', () => {
    expect(ManualHours.safeParse({ slots: [{ day: 1, opens: '12:00', closes: '12:00' }] }).success).toBe(false)
    expect(ManualHours.safeParse({ slots: [{ day: 7, opens: '12:00', closes: '13:00' }] }).success).toBe(false)
    expect(ManualHours.safeParse({ slots: [{ day: 1, opens: '12:00', closes: '13:00' }] }).success).toBe(true)
    expect(sortedSlots([{ day: 2, opens: '09:00', closes: '10:00' }, { day: 1, opens: '12:00', closes: '13:00' }, { day: 2, opens: '09:00', closes: '10:00' }]))
      .toEqual([{ day: 1, opens: '12:00', closes: '13:00' }, { day: 2, opens: '09:00', closes: '10:00' }])
  })
})
