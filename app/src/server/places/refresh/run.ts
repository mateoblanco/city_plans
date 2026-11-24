import 'server-only'
import type { Query } from '@shared/events.ts'
import {
  daysBefore,
  insertGoogleRefreshRunQuery,
  resolveGoogleFlagsQuery,
  staleCoordinatesQuery,
  upsertGoogleFlagQuery,
  type GoogleRefreshRun,
  type GoogleRefreshStopReason,
} from '@shared/google-flags.ts'
import type { RunQuery } from '../../events/visitor'
import { decide } from './decide'
import { fetchPlaceRefresh } from './google'

/**
 * Refresco diario de las coordenadas de Google (cron /api/cron/google-refresh). Los términos permiten guardar lat/lng
 * 30 días como máximo: cada corrida toma los publicados con coordenadas de más de `REFRESH_AFTER_DAYS` (los más viejos
 * primero, en tandas de `BATCH_SIZE`), pide sólo `location,movedPlaceId` y actualiza location y coordinates_fetched_at.
 * Lo raro (se movió más de 100 m, el place_id no existe o Google lo reemplazó) va a place_google_flags para revisar en
 * el backoffice; nunca despublica. Un 403 o 429 corta la corrida sin reintentar. Cada corrida deja una fila en
 * google_refresh_runs.
 */
export const BATCH_SIZE = 40
export const REFRESH_AFTER_DAYS = 25
export type StopReason = GoogleRefreshStopReason

/** Lo que queda en google_refresh_runs (flagged: lugares con algún aviso nuevo o reabierto; staleAfter: publicados con
 * coordenadas de más de 30 días al terminar), más cuántos se eligieron. */
export type RefreshSummary = GoogleRefreshRun & { selected: number }

type Candidate = { id: string; google_place_id: string; lat: number; lng: number }

export function selectCandidatesQuery(now: Date, batchSize: number): Query {
  return {
    text: `select id::text as id, google_place_id, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lng
from places
where status = 'published' and google_place_id is not null and coordinates_source = 'google'
  and (coordinates_fetched_at is null or coordinates_fetched_at < $1)
order by coordinates_fetched_at asc nulls first, id
limit $2`,
    params: [daysBefore(now, REFRESH_AFTER_DAYS), batchSize],
  }
}

/** No toca updated_at (no es una edición del lugar; el sitemap lo usa como última modificación). */
export function updateLocationQuery(placeId: string, lat: number, lng: number, now: Date): Query {
  return {
    text: `update places set location = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, coordinates_fetched_at = $4
where id = $1`,
    params: [placeId, lat, lng, now.toISOString()],
  }
}

const toCandidate = (row: Record<string, unknown>): Candidate | null => {
  const lat = Number(row.lat)
  const lng = Number(row.lng)
  if (typeof row.id !== 'string' || typeof row.google_place_id !== 'string' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { id: row.id, google_place_id: row.google_place_id, lat, lng }
}

export type RefreshOptions = {
  run: RunQuery
  fetchFn?: typeof fetch
  apiKey?: string | undefined
  now?: () => Date
  batchSize?: number
  log?: Pick<Console, 'log' | 'error'>
}

export async function runCoordinateRefresh(options: RefreshOptions): Promise<RefreshSummary> {
  const { run, fetchFn = fetch, now = () => new Date(), batchSize = BATCH_SIZE, log = console } = options
  const apiKey = options.apiKey?.trim()
  const startedAt = now()
  const summary: RefreshSummary = { batchSize, selected: 0, refreshed: 0, flagged: 0, failed: 0, stoppedReason: null, staleAfter: 0 }

  if (!apiKey) {
    summary.stoppedReason = 'missing_key'
    log.error('[google-refresh] Falta GOOGLE_PLACES_API_KEY: no se refrescó nada')
  } else {
    const rows = await run(selectCandidatesQuery(startedAt, batchSize))
    const candidates = rows.map(toCandidate).filter((row): row is Candidate => row !== null)
    summary.selected = candidates.length

    for (const place of candidates) {
      const result = await fetchPlaceRefresh(place.google_place_id, apiKey, fetchFn)
      if (result.kind === 'stop') {
        summary.stoppedReason = result.reason
        log.error(`[google-refresh] Corrida cortada (${result.reason}): ${result.message}`)
        break
      }
      if (result.kind === 'error') {
        summary.failed++
        log.error(`[google-refresh] Falló ${place.id}: ${result.message}`)
        continue
      }
      try {
        const decision = decide(place, result)
        const at = now()
        if (decision.update) {
          await run(updateLocationQuery(place.id, decision.update.lat, decision.update.lng, at))
          summary.refreshed++
        }
        if (decision.resolve.length) await run(resolveGoogleFlagsQuery(place.id, decision.resolve, at))
        let opened = false
        for (const flag of decision.flags) {
          if ((await run(upsertGoogleFlagQuery(place.id, flag, at))).length) opened = true
        }
        if (opened) summary.flagged++
      } catch (error) {
        summary.failed++
        log.error(`[google-refresh] No se pudo guardar ${place.id}`, error)
      }
    }
  }

  const [stale] = await run(staleCoordinatesQuery(now()))
  summary.staleAfter = Number(stale?.stale ?? 0)
  await run(insertGoogleRefreshRunQuery(startedAt, now(), summary))
  log.log(`[google-refresh] ${JSON.stringify(summary)}`)
  return summary
}
