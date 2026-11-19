import type { OpenStateText } from '@/server/search/labels'

/**
 * Estado de horario precalculado para toda la semana: lo arma el servidor con los textos de siempre (placeOpenText, los
 * de la ficha) y el navegador sólo elige el tramo de la hora actual de Montevideo. Así una página cacheada (las guías)
 * muestra "Abierto · Cierra 20:00" sin quedar vieja y sin llevar al cliente la lógica de horarios del servidor.
 *
 * `texts`: los textos distintos; `at`: [minuto de la semana desde el que vale, índice en texts o -1 sin estado], en
 * orden, el primero siempre desde 0 (domingo 00:00).
 */
export type WeekStatus = { texts: OpenStateText[]; at: [number, number][] }

export const MINUTES_PER_WEEK = 7 * 24 * 60

/** La misma zona que SEARCH_CONFIG.timeZone (lo verifica week-status.test.ts). */
export const MONTEVIDEO_TIME_ZONE = 'America/Montevideo'

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Minuto de la semana en Montevideo (0 = domingo 00:00). */
export function montevideoMinuteOfWeek(date = new Date()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: MONTEVIDEO_TIME_ZONE, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )
  return WEEKDAYS[parts.weekday] * 24 * 60 + Number(parts.hour) * 60 + Number(parts.minute)
}

/** El texto que vale en ese minuto; null sin estado (horario sin confirmar) o sin datos. */
export function statusAt(week: WeekStatus, minute: number): OpenStateText | null {
  let index = -1
  for (const [from, text] of week.at) {
    if (from > minute) break
    index = text
  }
  return index >= 0 ? week.texts[index] ?? null : null
}
