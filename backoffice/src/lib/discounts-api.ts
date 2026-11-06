import type { DiscountLinksRequest, DiscountPlace, DiscountRunProgress, DiscountsResponse } from '@/types/discounts'
import { parseApiResponse } from '@/lib/places-api'

/** Todo lo guardado y la última corrida. */
export async function getDiscounts(signal?: AbortSignal): Promise<DiscountsResponse> {
  return parseApiResponse<DiscountsResponse>(await fetch('/api/discounts', { signal }))
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
