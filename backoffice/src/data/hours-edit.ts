import { z } from 'zod'

// Horario cargado a mano en el modal: turnos por día (0 = domingo … 6 = sábado), siempre con cierre. Un turno que
// cruza la medianoche (20:00–02:00) se guarda en el día en que abre, como lo lee la app (openStatus en app/…/hours.ts).

export const HOUR_MINUTE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
export const MAX_SLOTS_PER_DAY = 4
export const DAY_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const
/** Orden del editor: de lunes a domingo. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export type ManualSlot = { day: number; opens: string; closes: string }

export const ManualSlot = z.object({
  day: z.number().int().min(0).max(6),
  opens: z.string().regex(HOUR_MINUTE),
  closes: z.string().regex(HOUR_MINUTE),
}).strict()

const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))

/** Minutos que ocupa el turno en su día: uno que cruza la medianoche va hasta las 24:00. */
function span(slot: ManualSlot): [number, number] {
  const opens = minutes(slot.opens)
  const closes = minutes(slot.closes)
  return [opens, closes <= opens ? 24 * 60 : closes]
}

export const crossesMidnight = (slot: Pick<ManualSlot, 'opens' | 'closes'>) =>
  HOUR_MINUTE.test(slot.opens) && HOUR_MINUTE.test(slot.closes) && minutes(slot.closes) < minutes(slot.opens)

export type HoursIssue = { day: number | null; message: string }

/** Problemas del horario, en español, por día (null = del horario entero). Vacío = se puede guardar. */
export function hoursSlotIssues(slots: readonly ManualSlot[]): HoursIssue[] {
  const issues: HoursIssue[] = []
  if (slots.length === 0) issues.push({ day: null, message: 'Cargá al menos un turno.' })
  for (const day of WEEK_ORDER) {
    const daySlots = slots.filter((slot) => slot.day === day)
    if (daySlots.length > MAX_SLOTS_PER_DAY) issues.push({ day, message: `Hasta ${MAX_SLOTS_PER_DAY} turnos por día.` })
    const valid = daySlots.filter((slot) => {
      if (!HOUR_MINUTE.test(slot.opens) || !HOUR_MINUTE.test(slot.closes)) {
        issues.push({ day, message: 'Completá la hora de apertura y de cierre (HH:MM).' })
        return false
      }
      if (slot.opens === slot.closes) {
        issues.push({ day, message: `El turno de las ${slot.opens} cierra a la misma hora en que abre.` })
        return false
      }
      return true
    })
    const sorted = valid.map(span).sort((left, right) => left[0] - right[0])
    if (sorted.some((current, index) => index > 0 && current[0] < sorted[index - 1][1])) {
      issues.push({ day, message: 'Hay turnos superpuestos.' })
    }
  }
  return issues
}

/** Turnos ordenados por día y apertura, sin repetidos: la forma en que se guardan y se comparan. */
export function sortedSlots(slots: readonly ManualSlot[]): ManualSlot[] {
  const seen = new Set<string>()
  return [...slots]
    .sort((left, right) => left.day - right.day || left.opens.localeCompare(right.opens))
    .filter((slot) => {
      const key = `${slot.day}:${slot.opens}:${slot.closes}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export const sameSlots = (left: readonly { day: number; opens: string; closes: string | null }[], right: readonly ManualSlot[]) => {
  const key = (slots: readonly { day: number; opens: string; closes: string | null }[]) =>
    [...slots].map((slot) => `${slot.day}:${slot.opens}:${slot.closes ?? ''}`).sort().join('|')
  return key(left) === key(right)
}

export const ManualHours = z.object({ slots: z.array(ManualSlot).max(7 * MAX_SLOTS_PER_DAY) }).strict()
  .superRefine((value, context) => {
    for (const issue of hoursSlotIssues(value.slots)) context.addIssue({ code: 'custom', message: issue.message, path: ['slots'] })
  })

export type ManualHours = z.infer<typeof ManualHours>
