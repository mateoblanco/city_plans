import { listSavedPlaces, parseApiResponse } from '@/lib/places-api'
import type { GuideCity, GuideGroup } from '@/data/guides'
import type {
  GuideAiStatusResponse,
  GuideCandidatesResponse,
  GuideGenerateRequest,
  GuideGenerateResponse,
  GuideIntrosResponse,
  GuideNeighborhoodCountsResponse,
  GuideListResponse,
  GuidePreviewUrlResponse,
  GuideResponse,
  GuideSaveRequest,
} from '@/types/guides'
import type { PlaceListItem } from '@/types/places'

const json = (body: unknown, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export type GuideListFilters = { status?: string; group?: string; neighborhood?: string; featured?: string }

export async function listGuides(filters: GuideListFilters = {}, signal?: AbortSignal): Promise<GuideListResponse> {
  const params = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])))
  return parseApiResponse<GuideListResponse>(await fetch(`/api/guides${params.size > 0 ? `?${params}` : ''}`, { signal }))
}

export async function getGuide(id: string, signal?: AbortSignal): Promise<GuideResponse> {
  return parseApiResponse<GuideResponse>(await fetch(`/api/guides/${encodeURIComponent(id)}`, { signal }))
}

/** Sin id crea la guía (borrador); con id la reemplaza. */
export async function saveGuide(id: string | null, request: GuideSaveRequest): Promise<GuideResponse> {
  const response = id ? await fetch(`/api/guides/${encodeURIComponent(id)}`, json(request, 'PUT')) : await fetch('/api/guides', json(request))
  return parseApiResponse<GuideResponse>(response)
}

export async function setGuidePublished(id: string, published: boolean): Promise<GuideResponse> {
  return parseApiResponse<GuideResponse>(await fetch(`/api/guides/${encodeURIComponent(id)}/${published ? 'publish' : 'unpublish'}`, { method: 'POST' }))
}

/** Elimina una guía en borrador (con sus lugares). Una publicada da error: hay que despublicarla antes. */
export async function deleteGuide(id: string): Promise<void> {
  await parseApiResponse<{ deleted: boolean }>(await fetch(`/api/guides/${encodeURIComponent(id)}`, { method: 'DELETE' }))
}

export async function setGuideFeatured(id: string, featured: boolean): Promise<void> {
  await parseApiResponse<{ featured: boolean }>(await fetch(`/api/guides/${encodeURIComponent(id)}/featured`, json({ featured }, 'PATCH')))
}

/** La URL de la vista previa en la app, con la clave (la agrega el servidor). */
export async function guidePreviewUrl(id: string): Promise<string> {
  return (await parseApiResponse<GuidePreviewUrlResponse>(await fetch(`/api/guides/${encodeURIComponent(id)}/preview-url`))).url
}

export async function listGuideIntros(signal?: AbortSignal): Promise<GuideIntrosResponse> {
  return parseApiResponse<GuideIntrosResponse>(await fetch('/api/guides/intros', { signal }))
}

export async function saveGuideIntro(city: GuideCity, neighborhoodId: string | null, intro: string): Promise<GuideIntrosResponse> {
  return parseApiResponse<GuideIntrosResponse>(await fetch('/api/guides/intros', json({ city, neighborhoodId, intro }, 'PUT')))
}

/** El buscador del editor: lugares publicados por nombre (el mismo GET /api/places de Lugares). */
export async function searchPublishedPlaces(q: string, signal?: AbortSignal): Promise<PlaceListItem[]> {
  return (await listSavedPlaces({ q, status: 'published', sort: 'name', page: 1, pageSize: 10 }, signal)).places
}

/** Candidatos para la guía desde una idea (la búsqueda de la app, con el barrio y el grupo de la guía). */
export async function searchGuideCandidates(idea: string, neighborhoodId: string | null, group: GuideGroup, signal?: AbortSignal): Promise<GuideCandidatesResponse> {
  return parseApiResponse<GuideCandidatesResponse>(await fetch('/api/guides/candidates', { ...json({ idea, neighborhoodId, group }), signal }))
}

/** Error de una generación: el mensaje, el link para cargar crédito (402) y lo que se pagó igual. */
export class GuideGenerateError extends Error {
  readonly code: string
  readonly creditUrl: string | null
  readonly costUsd: number
  readonly guideCostUsd: number | null
  constructor(code: string, message: string, extra: { creditUrl?: string | null; costUsd?: number; guideCostUsd?: number | null } = {}) {
    super(message)
    this.code = code
    this.creditUrl = extra.creditUrl ?? null
    this.costUsd = extra.costUsd ?? 0
    this.guideCostUsd = extra.guideCostUsd ?? null
  }
}

/** Genera un texto (borrador: nunca se guarda solo). Un error trae el código, el link de crédito y el costo pagado. */
export async function generateGuideText(request: GuideGenerateRequest): Promise<GuideGenerateResponse> {
  const response = await fetch('/api/guides/generate', json(request))
  const payload = (await response.json().catch(() => null)) as (GuideGenerateResponse & { error?: { code: string; message: string }; creditUrl?: string }) | null
  if (!response.ok || !payload) {
    throw new GuideGenerateError(payload?.error?.code ?? 'UNKNOWN_ERROR', payload?.error?.message ?? 'No se pudo generar.', {
      creditUrl: payload?.creditUrl,
      costUsd: payload?.costUsd,
      guideCostUsd: payload?.guideCostUsd,
    })
  }
  return payload
}

export async function getGuideNeighborhoodCounts(signal?: AbortSignal): Promise<GuideNeighborhoodCountsResponse> {
  return parseApiResponse<GuideNeighborhoodCountsResponse>(await fetch('/api/guides/neighborhood-counts', { signal }))
}

export async function getGuideAiStatus(signal?: AbortSignal): Promise<GuideAiStatusResponse> {
  return parseApiResponse<GuideAiStatusResponse>(await fetch('/api/guides/ai-status', { signal }))
}

/** "US$ 0,012": el costo de una generación (con más decimales si es chico). */
export const formatAiCost = (usd: number) => `US$ ${usd.toLocaleString('es-UY', { minimumFractionDigits: usd > 0 && usd < 0.01 ? 4 : 3, maximumFractionDigits: usd > 0 && usd < 0.01 ? 4 : 3 })}`
