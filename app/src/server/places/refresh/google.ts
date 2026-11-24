import 'server-only'

/**
 * Place Details (New) mínimo para el refresco de coordenadas (cron /api/cron/google-refresh). `location` es del SKU
 * Place Details Essentials (10.000 gratis por mes, después USD 5 cada 1.000) y `movedPlaceId` de Essentials IDs Only
 * (gratis): se cobra Essentials. `businessStatus` quedó afuera a propósito: es del SKU Pro (USD 17 cada 1.000).
 * Es un helper aparte del de la ficha (server/places/google.ts), así google-cost-guard.test.ts sigue valiendo.
 */
export const REFRESH_FIELD_MASK = 'location,movedPlaceId'

export type RefreshResult =
  | { kind: 'ok'; lat: number; lng: number; movedPlaceId: string | null }
  /** El place_id no existe más o no es válido (404 NOT_FOUND, o 400 por un id inválido). */
  | { kind: 'not_found' }
  /** Clave rechazada (401/403) o cuota agotada (429): la corrida corta, sin reintentar. */
  | { kind: 'stop'; reason: 'authorization' | 'quota'; message: string }
  /** Red, 5xx, cuerpo raro: cuenta como falla y se reintenta en la próxima corrida. */
  | { kind: 'error'; message: string }

type ErrorBody = { error?: { message?: string; status?: string } }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Nunca tira. */
export async function fetchPlaceRefresh(placeId: string, apiKey: string, fetchFn: typeof fetch = fetch): Promise<RefreshResult> {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
  let response: Response
  try {
    response = await fetchFn(url, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': REFRESH_FIELD_MASK },
      cache: 'no-store',
    })
  } catch (error) {
    return { kind: 'error', message: `Sin conexión con Google (${error instanceof Error ? error.message : String(error)})` }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Se decide por el código de estado.
  }

  if (!response.ok) {
    const detail = (body as ErrorBody | null)?.error
    const message = `Google respondió ${response.status}${detail?.message ? `: ${detail.message}` : ''}`
    const status = detail?.status
    if (response.status === 429 || status === 'RESOURCE_EXHAUSTED') return { kind: 'stop', reason: 'quota', message }
    // Una clave inválida llega como 400 INVALID_ARGUMENT "API key not valid": también corta.
    const badKey = response.status === 400 && /api key/i.test(detail?.message ?? '')
    if (badKey || response.status === 401 || response.status === 403 || status === 'PERMISSION_DENIED' || status === 'UNAUTHENTICATED') {
      return { kind: 'stop', reason: 'authorization', message }
    }
    if (response.status === 404 || status === 'NOT_FOUND') return { kind: 'not_found' }
    // 400 por un id truncado o inválido. Cualquier otro 400 (el pedido en sí está mal) es una falla, no se marca el lugar.
    if (response.status === 400 && /place ?id/i.test(detail?.message ?? '')) return { kind: 'not_found' }
    return { kind: 'error', message }
  }

  const location = isRecord(body) && isRecord(body.location) ? body.location : null
  const lat = location?.latitude
  const lng = location?.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { kind: 'error', message: 'Google respondió sin location' }
  }
  const moved = isRecord(body) && typeof body.movedPlaceId === 'string' && body.movedPlaceId ? body.movedPlaceId : null
  return { kind: 'ok', lat, lng, movedPlaceId: moved }
}
