import { SEARCH_CONFIG } from './config'
import type { OpenAt } from './interpretation'

export type Slot = { day: number; opens: string; closes: string | null }
export type Hours = { slots: Slot[]; status: 'exact' | 'partial' | 'vague' | 'none' }

/** Día (0 = domingo) y hora HH:MM; time null = en algún momento de ese día. */
export type Moment = { day: number; time: string | null }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function montevideoNow(date = new Date()): { day: number; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: SEARCH_CONFIG.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return { day: WEEKDAYS[parts.weekday], time: `${parts.hour}:${parts.minute}` }
}

/** El momento concreto que pide openAt, en hora de Montevideo. */
export function resolveOpenAt(openAt: OpenAt, now: Date): Moment | null {
  if (!openAt) return null
  const current = montevideoNow(now)
  if (openAt === 'now') return current
  return { day: openAt.day ?? current.day, time: openAt.time }
}

/** Sin horario confiable: no se excluye por horario, se muestra como "no confirmado". */
export function hoursConfirmed(hours: Hours) {
  return (hours.status === 'exact' || hours.status === 'partial') && hours.slots.length > 0
}

const crossesMidnight = (slot: Slot) => slot.closes !== null && slot.closes <= slot.opens

export type OpenState =
  | { state: 'open'; closesAt: string | null; opensAt?: string }
  | { state: 'closed' }
  | { state: 'unconfirmed' }

/**
 * Estado del lugar en un momento. Los horarios que cruzan la medianoche (12:00–01:00) cuentan para
 * el día siguiente hasta el cierre; closes null es "desde tal hora" sin cierre conocido.
 */
export function openStatus(hours: Hours, at: Moment): OpenState {
  if (!hoursConfirmed(hours)) return { state: 'unconfirmed' }
  if (at.time === null) {
    const slot = hours.slots.find((candidate) => candidate.day === at.day)
    return slot ? { state: 'open', opensAt: slot.opens, closesAt: slot.closes } : { state: 'closed' }
  }
  const time = at.time
  const previousDay = (at.day + 6) % 7
  for (const slot of hours.slots) {
    if (slot.day === at.day && slot.opens <= time && (slot.closes === null || crossesMidnight(slot) || time < slot.closes)) {
      return { state: 'open', closesAt: slot.closes }
    }
    if (slot.day === previousDay && crossesMidnight(slot) && time < slot.closes!) {
      return { state: 'open', closesAt: slot.closes }
    }
  }
  return { state: 'closed' }
}

/** Próxima apertura: días desde hoy (0 = hoy), el día y la hora. */
export type NextOpening = { daysAhead: number; day: number; opens: string }

/**
 * Cuándo vuelve a abrir un lugar cerrado en `at`: el turno más temprano que abre después de esa hora hoy o,
 * si no, en los 7 días siguientes (con dos turnos, a la tarde gana el segundo). null sin horario confiable.
 */
export function nextOpening(hours: Hours, at: { day: number; time: string }): NextOpening | null {
  if (!hoursConfirmed(hours)) return null
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const day = (at.day + daysAhead) % 7
    const opens = hours.slots
      .filter((slot) => slot.day === day && (daysAhead > 0 || slot.opens > at.time))
      .map((slot) => slot.opens)
      .sort()[0]
    if (opens) return { daysAhead, day, opens }
  }
  return null
}
