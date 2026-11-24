import type { Query } from './events.ts'

// Avisos del refresco de coordenadas de Google (cron /api/cron/google-refresh de la app; tabla place_google_flags).
// Fuente única: la app los escribe y el backoffice los muestra. Sólo códigos nuestros, nunca datos de Google.
export const GOOGLE_FLAG_REASONS = {
  moved: 'Se movió',
  not_found: 'No encontrado en Google',
  replaced: 'Google lo reemplazó por otro lugar',
} as const

export type GoogleFlagReason = keyof typeof GOOGLE_FLAG_REASONS
export const GOOGLE_FLAG_REASON_IDS = Object.keys(GOOGLE_FLAG_REASONS) as [GoogleFlagReason, ...GoogleFlagReason[]]

/** Por qué cortó una corrida: clave rechazada (401/403), cuota (429) o sin GOOGLE_PLACES_API_KEY. */
export const GOOGLE_REFRESH_STOP_REASONS = ['authorization', 'quota', 'missing_key'] as const
export type GoogleRefreshStopReason = (typeof GOOGLE_REFRESH_STOP_REASONS)[number]

/** Los publicados con coordenadas de Google de más de esto (o sin fecha) están fuera de los términos. */
export const COORDINATES_MAX_AGE_DAYS = 30

/** Un aviso a abrir. moved lleva los metros; replaced, el movedPlaceId que dio Google. */
export type GoogleFlag =
  | { reason: 'moved'; distanceM: number }
  | { reason: 'not_found' }
  | { reason: 'replaced'; newGooglePlaceId: string }

/**
 * Abre un aviso. Devuelve una fila si quedó abierto por esta corrida: nuevo, reabierto (estaba resuelto), "se movió"
 * otra vez (aunque estuviera ignorado: es un movimiento nuevo) o "reemplazado" por otro id distinto. Uno ya abierto o
 * ignorado del mismo hecho no se toca.
 */
export function upsertGoogleFlagQuery(placeId: string, flag: GoogleFlag, now: Date): Query {
  const distance = flag.reason === 'moved' ? flag.distanceM : null
  const newId = flag.reason === 'replaced' ? flag.newGooglePlaceId : null
  const reopen =
    flag.reason === 'moved'
      ? 'true'
      : flag.reason === 'replaced'
        ? 'f.resolved_at is not null or f.new_google_place_id is distinct from excluded.new_google_place_id'
        : 'f.resolved_at is not null'
  return {
    text: `insert into place_google_flags as f (place_id, reason, detected_at, distance_m, new_google_place_id)
values ($1, $2, $3, $4, $5)
on conflict (place_id, reason) do update set detected_at = excluded.detected_at, distance_m = excluded.distance_m,
  new_google_place_id = excluded.new_google_place_id, ignored_at = null, resolved_at = null
where ${reopen}
returning f.id`,
    params: [placeId, flag.reason, now.toISOString(), distance, newId],
  }
}

/** Cierra los avisos abiertos (o ignorados) de esos motivos que dejaron de valer. */
export function resolveGoogleFlagsQuery(placeId: string, reasons: GoogleFlagReason[], now: Date): Query {
  return {
    text: `update place_google_flags set resolved_at = $2
where place_id = $1 and reason = any($3::text[]) and resolved_at is null`,
    params: [placeId, now.toISOString(), reasons],
  }
}

const DAY_MS = 24 * 60 * 60 * 1000
export const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY_MS).toISOString()

/** Publicados con coordenadas de Google de más de 30 días (o sin fecha): el control de que el refresco va al día. */
export function staleCoordinatesQuery(now: Date): Query {
  return {
    text: `select count(*)::int as stale from places
where status = 'published' and coordinates_source = 'google'
  and (coordinates_fetched_at is null or coordinates_fetched_at < $1)`,
    params: [daysBefore(now, COORDINATES_MAX_AGE_DAYS)],
  }
}

export type GoogleRefreshRun = {
  batchSize: number
  refreshed: number
  flagged: number
  failed: number
  stoppedReason: GoogleRefreshStopReason | null
  staleAfter: number
}

export function insertGoogleRefreshRunQuery(startedAt: Date, finishedAt: Date, run: GoogleRefreshRun): Query {
  return {
    text: `insert into google_refresh_runs (started_at, finished_at, batch_size, refreshed, flagged, failed, stopped_reason, stale_after)
values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    params: [
      startedAt.toISOString(),
      finishedAt.toISOString(),
      run.batchSize,
      run.refreshed,
      run.flagged,
      run.failed,
      run.stoppedReason,
      run.staleAfter,
    ],
  }
}
