import { montevideoDate, montevideoNow } from '../search/hours'

/**
 * Franjas del día de la home, en hora de Montevideo (HH:MM de montevideoNow): el límite de abajo es de la franja (06:00
 * ya es mañana, 11:00 ya es mediodía) y el de arriba de la siguiente.
 */
export const HOME_SLOTS = [
  { id: 'late', from: '00:00' },
  { id: 'morning', from: '06:00' },
  { id: 'midday', from: '11:00' },
  { id: 'afternoon', from: '15:00' },
  { id: 'night', from: '19:00' },
] as const

export type SlotId = (typeof HOME_SLOTS)[number]['id']

/** La franja de una hora HH:MM. */
export function homeSlot(time: string): SlotId {
  let slot: SlotId = 'late'
  for (const candidate of HOME_SLOTS) if (time >= candidate.from) slot = candidate.id
  return slot
}

/** Uruguay no tiene horario de verano: siempre UTC−3. */
export const MONTEVIDEO_OFFSET = '-03:00'

/** Una fecha y hora de Montevideo (YYYY-MM-DD, HH:MM) como instante. */
export const montevideoInstant = (date: string, time: string) => new Date(`${date}T${time}:00${MONTEVIDEO_OFFSET}`)

/** La clave de la caché de las filas: fecha y franja de Montevideo (`2026-11-16|night`). */
export function slotKey(now: Date): string {
  return `${montevideoDate(now)}|${homeSlot(montevideoNow(now).time)}`
}

/** La franja y el instante en que empieza, de una clave de slotKey. */
export function parseSlotKey(key: string): { slot: SlotId; start: Date } {
  const [date, slot] = key.split('|') as [string, SlotId]
  const from = HOME_SLOTS.find((candidate) => candidate.id === slot)?.from ?? '00:00'
  return { slot, start: montevideoInstant(date, from) }
}

/** Cuándo empieza la franja siguiente (a la medianoche, la trasnoche del día siguiente). */
export function nextSlotStart(now: Date): Date {
  const { time } = montevideoNow(now)
  const next = HOME_SLOTS.find((candidate) => candidate.from > time)
  if (next) return montevideoInstant(montevideoDate(now), next.from)
  // Después de la última franja: la medianoche siguiente (24 h después de la de hoy).
  return new Date(montevideoInstant(montevideoDate(now), '00:00').getTime() + 24 * 60 * 60_000)
}
