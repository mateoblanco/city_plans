import { montevideoDate } from '../search/hours'
import { MONTEVIDEO_OFFSET } from './slots'
const FULL = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/
const TIME = /^T?([01]\d|2[0-3]):([0-5]\d)$/

/**
 * `?now=` de la home para ver cada franja, sólo en desarrollo: `2026-11-14T20:30` o `20:30` (hoy), en hora de Montevideo.
 * En producción (o con un valor inválido) se ignora: null, y la home usa la hora real.
 */
export function parseDevNow(raw: string | string[] | undefined | null, env: string | undefined = process.env.NODE_ENV, today: Date = new Date()): Date | null {
  if (env !== 'development' || typeof raw !== 'string') return null
  const value = raw.trim()
  const full = FULL.exec(value)
  const time = full ? null : TIME.exec(value)
  if (!full && !time) return null
  const iso = full ? `${full[1]}T${full[2]}:${full[3]}` : `${montevideoDate(today)}T${time![1]}:${time![2]}`
  const date = new Date(`${iso}:00${MONTEVIDEO_OFFSET}`)
  return Number.isNaN(date.getTime()) ? null : date
}
