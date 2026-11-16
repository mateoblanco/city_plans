import type { NextRequest } from 'next/server'
import { runDailySummary } from '@/server/events/summary'

/**
 * Cron diario de Vercel (app/vercel.json, 04:00 UTC = 01:00 en Montevideo): resumen del día anterior y limpieza de
 * eventos de más de 90 días. Vercel manda `Authorization: Bearer <CRON_SECRET>`; sin la variable o con otro valor, 401.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    return Response.json(await runDailySummary())
  } catch (error) {
    console.error('Error en /api/cron/events-daily', error)
    return Response.json({ error: 'No pudimos armar el resumen' }, { status: 500 })
  }
}
