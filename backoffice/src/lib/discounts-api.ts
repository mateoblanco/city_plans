import type {
  DiscountLinksRequest,
  DiscountPlace,
  DiscountRunProgress,
  DiscountsListResponse,
  GoogleCandidatesResponse,
  OurPlaceOption,
  OurPlacesResponse,
  PlaceSearchEstimate,
  PlaceSearchProgress,
  StoredPlaceSearch,
} from '@/types/discounts'
import { parseApiResponse } from '@/lib/places-api'

/** Todo lo guardado, la última corrida y las búsquedas en Google guardadas. */
export async function getDiscounts(signal?: AbortSignal): Promise<DiscountsListResponse> {
  return parseApiResponse<DiscountsListResponse>(await fetch('/api/discounts', { signal }))
}

/** Arranca "Actualizar descuentos" en el servidor. 409 si ya hay una corrida. */
export async function startDiscountRun(): Promise<{ runId: string }> {
  return parseApiResponse<{ runId: string }>(await fetch('/api/discounts/runs', { method: 'POST' }))
}

export async function getDiscountRunProgress(signal?: AbortSignal): Promise<DiscountRunProgress> {
  return parseApiResponse<DiscountRunProgress>(await fetch('/api/discounts/runs/current', { signal }))
}

const placeUrl = (id: string, action: string) => `/api/discounts/places/${encodeURIComponent(id)}/${action}`

async function placeResponse(response: Response): Promise<DiscountPlace> {
  return (await parseApiResponse<{ place: DiscountPlace }>(response)).place
}

/** Confirma el cruce encontrado: queda manual. */
export async function confirmDiscountMatch(id: string): Promise<DiscountPlace> {
  return placeResponse(await fetch(placeUrl(id, 'confirm'), { method: 'POST' }))
}

/** Reemplaza los vínculos por estos (manuales). Una lista vacía desvincula todo. */
export async function setDiscountLinks(id: string, links: DiscountLinksRequest['links']): Promise<DiscountPlace> {
  return placeResponse(await fetch(placeUrl(id, 'links'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links } satisfies DiscountLinksRequest),
  }))
}

export async function setDiscountIgnored(id: string, ignored: boolean): Promise<DiscountPlace> {
  return placeResponse(await fetch(placeUrl(id, 'ignored'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ignored }),
  }))
}

/** Vuelve a automático y se cruza de nuevo. */
export async function resetDiscountMatch(id: string): Promise<DiscountPlace> {
  return placeResponse(await fetch(placeUrl(id, 'auto'), { method: 'POST' }))
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Busca en Google las filas de "No están en la base" (en el servidor). 409 si ya hay una búsqueda. */
export async function startPlaceSearch(rows: string[]): Promise<{ jobId: string }> {
  return parseApiResponse<{ jobId: string }>(await fetch('/api/discounts/searches', json({ rows })))
}

export async function getPlaceSearchProgress(signal?: AbortSignal): Promise<PlaceSearchProgress> {
  return parseApiResponse<PlaceSearchProgress>(await fetch('/api/discounts/searches/current', { signal }))
}

export async function getPlaceSearchEstimate(signal?: AbortSignal): Promise<PlaceSearchEstimate> {
  return parseApiResponse<PlaceSearchEstimate>(await fetch('/api/discounts/searches/estimate', { signal }))
}

/**
 * Un dudoso: el candidato elegido (va a extracción) o null ("Ninguno": no encontrado). Devuelve las búsquedas guardadas
 * de los lugares de la fila, para actualizarla sin recargar.
 */
export async function pickPlaceSearchCandidate(rowKey: string, placeId: string | null): Promise<Record<string, StoredPlaceSearch[]>> {
  return (await parseApiResponse<{ ok: true; searches?: Record<string, StoredPlaceSearch[]> }>(await fetch('/api/discounts/searches/pick', json({ rowKey, placeId })))).searches ?? {}
}

/** Descartar (o volver a mostrar) varios lugares del proveedor a la vez. Devuelve los lugares actualizados. */
export async function setDiscountIgnoredMany(ids: string[], ignored: boolean): Promise<DiscountPlace[]> {
  return (await parseApiResponse<{ places: DiscountPlace[] }>(await fetch('/api/discounts/places/ignored', json({ ids, ignored })))).places
}

/** Buscar en todos nuestros lugares (nombre, Instagram o marca), con la distancia al local si hay coordenadas. */
export async function searchOurPlaces(q: string, near: { lat: number; lng: number } | null, signal?: AbortSignal): Promise<OurPlaceOption[]> {
  const params = new URLSearchParams({ q })
  if (near) {
    params.set('lat', String(near.lat))
    params.set('lng', String(near.lng))
  }
  return (await parseApiResponse<OurPlacesResponse>(await fetch(`/api/discounts/our-places?${params}`, { signal }))).places
}

/** Sugerencias sin escribir: cerca (≤ 300 m), mismo Instagram, nombres parecidos y los candidatos del cruce. */
export async function getOurPlaceSuggestions(
  target: { name: string; coordinates: { lat: number; lng: number } | null; instagram: string | null; candidateIds?: string[] },
  signal?: AbortSignal,
): Promise<OurPlaceOption[]> {
  return (await parseApiResponse<OurPlacesResponse>(await fetch('/api/discounts/our-places/suggestions', { ...json(target), signal }))).places
}

/** Buscar la fila en Google ahora (Text Search). Se guarda sólo place_id y coordenadas. */
export async function lookupPlaceInGoogle(rowKey: string): Promise<GoogleCandidatesResponse> {
  return parseApiResponse<GoogleCandidatesResponse>(await fetch('/api/discounts/searches/google', json({ rowKey })))
}

/** Nombre y dirección de los candidatos guardados de la fila (de la memoria del servidor o de Google otra vez). */
export async function getCandidateNames(rowKey: string, signal?: AbortSignal): Promise<GoogleCandidatesResponse> {
  return parseApiResponse<GoogleCandidatesResponse>(await fetch('/api/discounts/searches/candidates', { ...json({ rowKey }), signal }))
}
