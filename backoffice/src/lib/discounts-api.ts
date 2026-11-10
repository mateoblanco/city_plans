import type { DiscountLinksRequest, DiscountPlace, DiscountRunProgress, DiscountsListResponse, PlaceSearchEstimate, PlaceSearchProgress } from '@/types/discounts'
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

/** Un dudoso: el candidato elegido (va a extracción) o null ("Ninguno": no encontrado). */
export async function pickPlaceSearchCandidate(rowKey: string, placeId: string | null): Promise<void> {
  await parseApiResponse<{ ok: true }>(await fetch('/api/discounts/searches/pick', json({ rowKey, placeId })))
}
