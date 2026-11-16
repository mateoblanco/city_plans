import 'server-only'
import { insertEventQuery, montevideoDay, type EventOrigin, type EventType, type Query } from '@shared/events.ts'
import { getSql } from '../db'
import { daySalt, visitorCode, type RunQuery } from './visitor'

export type EventBody = { placeId: string; type: EventType; origin: EventOrigin; row: string | null }
export type Client = { ip: string; userAgent: string }

export const neonRun: RunQuery = (query: Query) => getSql().query(query.text, query.params) as Promise<Record<string, unknown>[]>

/** Guarda un evento (una vez por código, lugar, tipo y día; lo garantiza la base). */
export async function recordEvent(body: EventBody, client: Client, run: RunQuery = neonRun, now: Date = new Date()) {
  const day = montevideoDay(now)
  const visitor = visitorCode(await daySalt(day, run), client.ip, client.userAgent)
  // La fila sólo se guarda con origen home o saved.
  const originRow = body.origin === 'home' || body.origin === 'saved' ? body.row : null
  await run(insertEventQuery({ placeId: body.placeId, type: body.type, visitor, day, origin: body.origin, originRow }))
}
