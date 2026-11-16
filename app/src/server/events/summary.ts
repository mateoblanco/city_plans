import 'server-only'
import {
  addDays,
  deleteOldEventsQuery,
  deleteOldSaltsQuery,
  EVENT_RETENTION_DAYS,
  montevideoDay,
  summarizeQuery,
  SUMMARY_DAYS,
} from '@shared/events.ts'
import type { RunQuery } from './visitor'
import { neonRun } from './record'

/**
 * Cron diario: rearma el resumen de los últimos días cerrados (ayer incluido; idempotente, así se pone al día si una
 * corrida falló), borra los eventos individuales de más de 90 días y las claves de los días anteriores.
 */
export async function runDailySummary(run: RunQuery = neonRun, now: Date = new Date()) {
  const today = montevideoDay(now)
  const from = addDays(today, -SUMMARY_DAYS)
  const before = addDays(today, -EVENT_RETENTION_DAYS)
  await run(summarizeQuery(from, today))
  await run(deleteOldEventsQuery(before))
  await run(deleteOldSaltsQuery(today))
  return { summarized: { from, to: addDays(today, -1) }, deletedBefore: before }
}
