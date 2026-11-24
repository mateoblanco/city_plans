import type { NextRequest } from 'next/server'
import { neonRun } from '@/server/events/record'
import { runCoordinateRefresh } from '@/server/places/refresh/run'

// 40 Place Details secuenciales entran holgados.
export const maxDuration = 60

/**
 * Cron diario de Vercel (app/vercel.json, 07:00 UTC = 04:00 en Montevideo): refresca las coordenadas de Google de una
 * tanda de lugares y marca los que se movieron o ya no están en Google (server/places/refresh/run.ts). Vercel manda
 * `Authorization: Bearer <CRON_SECRET>`; sin la variable o con otro valor, 401.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    return Response.json(await runCoordinateRefresh({ run: neonRun, apiKey: process.env.GOOGLE_PLACES_API_KEY }))
  } catch (error) {
    console.error('Error en /api/cron/google-refresh', error)
    return Response.json({ error: 'No pudimos refrescar las coordenadas' }, { status: 500 })
  }
}
