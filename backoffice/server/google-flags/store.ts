import type { NeonQueryFunction } from '@neondatabase/serverless'
import { staleCoordinatesQuery, type GoogleFlagReason, type GoogleRefreshStopReason } from '../../src/data/google-flags.ts'
import type { ReviewReason } from '../../src/data/review-reasons.ts'
import type { GoogleFlagItem, GoogleFlagsResponse } from '../../src/types/google-flags.ts'

/**
 * Avisos del refresco de coordenadas de Google (los escribe el cron de la app: app/src/server/places/refresh/). Acá se
 * leen y se resuelven a mano: "Ignorar" pone ignored_at; "Despublicar" manda el lugar a revisión con el motivo y cierra
 * el aviso. Ninguno cambia updated_at del lugar.
 */
export type GoogleFlagsStore = {
  list(now?: Date): Promise<GoogleFlagsResponse>
  /** false si el aviso no existe o ya no está abierto. */
  ignore(flagId: string, now?: Date): Promise<boolean>
  /** not_found si el aviso no existe o ya no está abierto; not_published si el lugar ya no estaba publicado. */
  unpublish(flagId: string, now?: Date): Promise<'unpublished' | 'not_found' | 'not_published'>
}

type Run = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>

/** Motivo de revisión con el que "Despublicar" manda el lugar a "A revisar". */
export const UNPUBLISH_REASON: Record<GoogleFlagReason, ReviewReason> = {
  moved: 'location_moved',
  not_found: 'not_found_in_google',
  replaced: 'not_found_in_google',
}

const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString())
const numberOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value))

// Sólo los de lugares todavía publicados: si alguien lo despublicó por otro lado, el aviso ya no hace falta.
const LIST_SQL = `select f.id::text as id, f.place_id::text as place_id, p.name, f.reason, f.detected_at, f.distance_m,
  f.new_google_place_id
from place_google_flags f join places p on p.id = f.place_id
where f.ignored_at is null and f.resolved_at is null and p.status = 'published'
order by f.detected_at desc, p.name`

const LAST_RUN_SQL = `select started_at, refreshed, flagged, failed, stopped_reason from google_refresh_runs
order by started_at desc limit 1`

// Una sola sentencia (neon-http no tiene transacciones): cierra el aviso y, si el lugar sigue publicado, lo pasa a
// review con el motivo sumado a los que tenía. Como Publicar, la decisión queda en manual_overrides (status y
// review_reasons) para que una extracción o places:check-status no la revierta; se deshace con Publicar.
const UNPUBLISH_SQL = `with flag as (
  update place_google_flags set resolved_at = $2
  where id = $1 and ignored_at is null and resolved_at is null
  returning place_id, reason
), target as (
  select p.id, array(select distinct r from unnest(p.review_reasons || array[
    case flag.reason when 'moved' then '${UNPUBLISH_REASON.moved}' else '${UNPUBLISH_REASON.not_found}' end
  ]::text[]) as r order by r) as reasons
  from places p join flag on p.id = flag.place_id
  where p.status = 'published'
), moved as (
  update places p set status = 'review', review_reasons = target.reasons,
    manual_overrides = p.manual_overrides || jsonb_build_object('status', 'review', 'review_reasons', to_jsonb(target.reasons))
  from target where p.id = target.id
  returning p.id
)
select (select count(*) from flag)::int as flags, (select count(*) from moved)::int as places`

export function googleFlagsStore(run: Run): GoogleFlagsStore {
  return {
    async list(now = new Date()) {
      const stale = staleCoordinatesQuery(now)
      const [rows, staleRows, runs] = await Promise.all([run(LIST_SQL, []), run(stale.text, stale.params), run(LAST_RUN_SQL, [])])
      const flags: GoogleFlagItem[] = rows.map((row) => ({
        id: String(row.id),
        placeId: String(row.place_id),
        placeName: String(row.name),
        reason: row.reason as GoogleFlagReason,
        detectedAt: iso(row.detected_at),
        distanceM: numberOrNull(row.distance_m),
        newGooglePlaceId: (row.new_google_place_id as string | null) ?? null,
      }))
      const last = runs[0]
      return {
        flags,
        stale: Number(staleRows[0]?.stale ?? 0),
        lastRun: last
          ? {
              startedAt: iso(last.started_at),
              refreshed: Number(last.refreshed),
              flagged: Number(last.flagged),
              failed: Number(last.failed),
              stoppedReason: (last.stopped_reason as GoogleRefreshStopReason | null) ?? null,
            }
          : null,
      }
    },
    async ignore(flagId, now = new Date()) {
      const rows = await run(
        `update place_google_flags set ignored_at = $2 where id = $1 and ignored_at is null and resolved_at is null returning id`,
        [flagId, now.toISOString()]
      )
      return rows.length > 0
    },
    async unpublish(flagId, now = new Date()) {
      const [result] = await run(UNPUBLISH_SQL, [flagId, now.toISOString()])
      if (!Number(result?.flags)) return 'not_found'
      return Number(result?.places) ? 'unpublished' : 'not_published'
    },
  }
}

export function neonGoogleFlagsStore(client: NeonQueryFunction<false, false>): GoogleFlagsStore {
  return googleFlagsStore((text, params) => client.query(text, params) as Promise<Record<string, unknown>[]>)
}
