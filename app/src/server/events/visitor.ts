import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { readSaltQuery, upsertSaltQuery, type Query } from '@shared/events.ts'

export type RunQuery = (query: Query) => Promise<Record<string, unknown>[]>

/**
 * Código anónimo del día: sha256(clave del día ‖ IP ‖ user agent), recortado. La IP y el user agent se usan sólo acá y
 * nunca se guardan ni se loguean. La clave es aleatoria (no sale de una clave fija) y el cron la borra al terminar el
 * día: después no hay forma de recalcular los códigos.
 */
export function visitorCode(salt: string, ip: string, userAgent: string): string {
  return createHash('sha256').update(salt).update('\0').update(ip).update('\0').update(userAgent).digest('hex').slice(0, 32)
}

let cached: { day: string; salt: string } | null = null

/** Clave del día: en memoria por instancia; si no está, la crea en la base (o lee la que creó otra instancia). */
export async function daySalt(day: string, run: RunQuery): Promise<string> {
  if (cached?.day === day) return cached.salt
  let rows = await run(upsertSaltQuery(day, randomBytes(32).toString('hex')))
  if (rows.length === 0) rows = await run(readSaltQuery(day))
  const salt = rows[0]?.salt
  if (typeof salt !== 'string') throw new Error('No se pudo leer la clave del día')
  cached = { day, salt }
  return salt
}

/** Para los tests. */
export const resetSaltCache = () => {
  cached = null
}
