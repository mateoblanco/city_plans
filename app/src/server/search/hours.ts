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

/** Fecha de Montevideo (YYYY-MM-DD): cambia a la medianoche de allá, no a la del servidor. */
export function montevideoDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SEARCH_CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/**
 * El horario pedido, resuelto contra la hora de Montevideo:
 * - now: abierto en `moment` ("Abierto ahora", el filtro de la barra).
 * - window: abierto en algún momento de hoy entre `from` y `until` (null = hasta el cierre de la noche): "Hoy" (desde
 *   ahora), "Esta noche" (desde max(ahora, night.from), sólo turnos que llegan a la noche: `night`) y "Hoy al mediodía"
 *   (max(ahora, midday.from)–midday.until).
 * - at: un día u hora concretos ("el sábado", "mañana a la noche").
 * confirmed: sin los lugares de horario sin confirmar (now y window); at los deja pasar, como siempre.
 */
export type OpenFilter =
  | { kind: 'now'; moment: { day: number; time: string }; confirmed: true }
  | { kind: 'window'; moment: { day: number; time: string }; from: string; until: string | null; night: boolean; confirmed: true }
  | { kind: 'at'; moment: Moment; confirmed: false }

/** El momento concreto que pide openAt, en hora de Montevideo. */
export function resolveOpenAt(openAt: OpenAt, now: Date): OpenFilter | null {
  if (!openAt) return null
  const current = montevideoNow(now)
  if (openAt === 'now') return { kind: 'now', moment: current, confirmed: true }
  if (openAt === 'today' || openAt === 'tonight') {
    const night = openAt === 'tonight'
    return { kind: 'window', moment: current, from: opensTodayFrom(current.time, night), until: null, night, confirmed: true }
  }
  if (openAt === 'midday') {
    const { from, until } = SEARCH_CONFIG.midday
    return { kind: 'window', moment: current, from: current.time > from ? current.time : from, until, night: false, confirmed: true }
  }
  return { kind: 'at', moment: { day: openAt.day ?? current.day, time: openAt.time }, confirmed: false }
}

/**
 * Desde qué hora cuenta "Hoy": ahora o, a la noche y antes de que empiece, desde SEARCH_CONFIG.night.from.
 * En la madrugada (antes de night.until) sigue siendo la noche anterior: cuenta ahora.
 */
export function opensTodayFrom(time: string, night: boolean): string {
  const { from, until } = SEARCH_CONFIG.night
  return night && time >= until && time < from ? from : time
}

/** Un turno que llega a la noche: sigue abierto después de night.from (o cruza la medianoche, o no tiene cierre). */
export const reachesNight = (slot: Slot) => slot.closes === null || crossesMidnight(slot) || slot.closes > SEARCH_CONFIG.night.from

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

/**
 * Abierto en algún momento de la ventana de hoy: abierto a `from` (también un turno de ayer que cruza la medianoche) o
 * con un turno de ese día que abre después de `from` y antes de `until` (null: sin tope). night: sólo turnos que llegan
 * a la noche (cenar a las 13:00 no trae un lugar que cierra a las 15:00). Ventana vacía (from ≥ until): no. Sin horario
 * confiable no se sabe.
 */
export function opensWithin(hours: Hours, day: number, window: { from: string; until: string | null; night: boolean }): 'yes' | 'no' | 'unconfirmed' {
  if (!hoursConfirmed(hours)) return 'unconfirmed'
  const { from, until, night } = window
  if (until !== null && from >= until) return 'no'
  if (openStatus(hours, { day, time: from }).state === 'open') return 'yes'
  return hours.slots.some((slot) => slot.day === day && slot.opens > from && (until === null || slot.opens < until) && (!night || reachesNight(slot))) ? 'yes' : 'no'
}

/** "Hoy" / "Esta noche": abierto ahora (o desde la noche) o con un turno que abre más tarde ese día. */
export function opensToday(hours: Hours, at: { day: number; time: string }, night = false): 'yes' | 'no' | 'unconfirmed' {
  return opensWithin(hours, at.day, { from: opensTodayFrom(at.time, night), until: null, night })
}

/** Si el lugar cumple el horario pedido: 'unconfirmed' sin horario confiable (now y window lo sacan, at no). */
export function matchesOpenFilter(hours: Hours, filter: OpenFilter): 'yes' | 'no' | 'unconfirmed' {
  if (filter.kind === 'window') return opensWithin(hours, filter.moment.day, filter)
  const state = openStatus(hours, filter.moment).state
  return state === 'open' ? 'yes' : state === 'closed' ? 'no' : 'unconfirmed'
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
