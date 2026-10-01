import type {
  ApiErrorResponse,
  ExaPlaceResponse,
  GooglePlaceDetailsResponse,
  MatchSource,
  PlaceAnchor,
  PlaceEnrichmentResponse,
  PlaceMatchResponse,
  PlaceSummary,
  PlacesSearchRequest,
  PlacesSearchResponse,
} from '@/types/places'

export class PlacesApiError extends Error {
  readonly code: ApiErrorResponse['error']['code']

  constructor(
    code: ApiErrorResponse['error']['code'],
    message: string,
  ) {
    super(message)
    this.name = 'PlacesApiError'
    this.code = code
  }
}

export async function searchPlaces(
  request: PlacesSearchRequest,
  signal?: AbortSignal,
): Promise<PlacesSearchResponse> {
  const response = await fetch('/api/places/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })

  const payload = (await response.json().catch(() => null)) as
    | PlacesSearchResponse
    | ApiErrorResponse
    | null

  if (!response.ok) {
    const error = payload && 'error' in payload ? payload.error : null
    throw new PlacesApiError(
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'No se pudo completar la búsqueda.',
    )
  }

  return payload as PlacesSearchResponse
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | T
    | ApiErrorResponse
    | null

  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload
      ? payload.error
      : null
    throw new PlacesApiError(
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'No se pudo completar la consulta.',
    )
  }

  return payload as T
}

export async function getGooglePlaceDetails(
  placeId: string,
  signal?: AbortSignal,
): Promise<GooglePlaceDetailsResponse> {
  const response = await fetch(
    `/api/places/${encodeURIComponent(placeId)}/google-details`,
    { signal },
  )
  return parseApiResponse<GooglePlaceDetailsResponse>(response)
}

export async function searchPlaceWithExa(
  name: string,
  refresh = false,
  signal?: AbortSignal,
): Promise<ExaPlaceResponse> {
  const response = await fetch('/api/places/exa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, refresh }),
    signal,
  })
  return parseApiResponse<ExaPlaceResponse>(response)
}

export async function matchPlaceSource(
  source: MatchSource,
  anchor: PlaceAnchor,
  signal?: AbortSignal,
): Promise<PlaceMatchResponse> {
  const response = await fetch(`/api/place-matches/${source}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ anchor }),
    signal,
  })
  return parseApiResponse<PlaceMatchResponse>(response)
}

export async function extractPlace(
  placeId: string,
  request: { name: string; seedCategory: PlaceSummary['seedCategory']; refresh?: boolean },
  signal?: AbortSignal,
): Promise<PlaceEnrichmentResponse> {
  const response = await fetch(
    `/api/places/${encodeURIComponent(placeId)}/extract`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal },
  )
  return parseApiResponse<PlaceEnrichmentResponse>(response)
}
