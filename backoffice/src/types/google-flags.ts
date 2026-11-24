import type { GoogleFlagReason, GoogleRefreshStopReason } from '../data/google-flags.ts'

/** Un aviso abierto del refresco de coordenadas (Lugares › Avisos de Google). */
export type GoogleFlagItem = {
  id: string
  placeId: string
  placeName: string
  reason: GoogleFlagReason
  detectedAt: string
  /** Sólo moved: metros que se movió. */
  distanceM: number | null
  /** Sólo replaced: el place_id nuevo que indicó Google. */
  newGooglePlaceId: string | null
}

export type GoogleRefreshRunSummary = {
  startedAt: string
  refreshed: number
  flagged: number
  failed: number
  stoppedReason: GoogleRefreshStopReason | null
}

export type GoogleFlagsResponse = {
  flags: GoogleFlagItem[]
  /** Publicados con coordenadas de Google de más de 30 días (o sin fecha), ahora. */
  stale: number
  lastRun: GoogleRefreshRunSummary | null
}
