import { metersBetween, type LatLng } from '@/lib/location'
import type { GoogleFlag, GoogleFlagReason } from '@shared/google-flags.ts'
import type { RefreshResult } from './google'

export type FlagReason = GoogleFlagReason

export const MOVED_THRESHOLD_M = 100

export type Flag = GoogleFlag

export type Decision = {
  /** Coordenadas nuevas (y coordinates_fetched_at = ahora); sin esto no se toca el lugar. */
  update: LatLng | null
  flags: Flag[]
  /** Avisos abiertos que dejan de valer (se marcan resueltos). */
  resolve: FlagReason[]
}

/** Qué hacer con un lugar según la respuesta de Google. Sólo para ok y not_found (stop y error los maneja la corrida). */
export function decide(current: LatLng, result: Extract<RefreshResult, { kind: 'ok' | 'not_found' }>, thresholdM = MOVED_THRESHOLD_M): Decision {
  if (result.kind === 'not_found') return { update: null, flags: [{ reason: 'not_found' }], resolve: [] }

  const next = { lat: result.lat, lng: result.lng }
  const flags: Flag[] = []
  const distance = metersBetween(current, next)
  if (distance > thresholdM) flags.push({ reason: 'moved', distanceM: Math.round(distance) })
  if (result.movedPlaceId) flags.push({ reason: 'replaced', newGooglePlaceId: result.movedPlaceId })
  // El id respondió: un "no encontrado" viejo ya no vale; si Google no indica reemplazo, tampoco uno de "reemplazado".
  const resolve: FlagReason[] = result.movedPlaceId ? ['not_found'] : ['not_found', 'replaced']
  return { update: next, flags, resolve }
}
