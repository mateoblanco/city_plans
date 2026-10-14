import type {
  ApiErrorResponse,
  ExaPlaceResponse,
  ExtractionReportRequest,
  GooglePlaceDetailsResponse,
  MatchSource,
  NeighborhoodSweepEvent,
  NeighborhoodSweepMode,
  PlaceAnchor,
  PlaceEnrichmentResponse,
  PlaceListItem,
  PlaceMatchResponse,
  PlaceSummary,
  PlacesSearchRequest,
  PlacesSearchResponse,
  SavePlaceResult,
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

export type ExtractRequest = {
  googlePlaceId: string
  seedCategories: PlaceSummary['seedCategories']
  /** Opcional: si falta, el servidor lo calcula con las coordenadas. */
  neighborhoodId?: string
}

/** Corre el pipeline completo para un lugar. Cada llamada es independiente y sin estado. */
export async function extractPlace(
  request: ExtractRequest,
  signal?: AbortSignal,
): Promise<PlaceEnrichmentResponse> {
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  return parseApiResponse<PlaceEnrichmentResponse>(response)
}

/** Al terminar un lote, el servidor escribe el reporte de lo que el pipeline no resolvió. */
export async function saveExtractionReport(report: ExtractionReportRequest): Promise<{ path: string }> {
  const response = await fetch('/api/extraction-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  })
  return parseApiResponse<{ path: string }>(response)
}

/** Guarda resultados del pipeline en la base: crea o actualiza cada lugar. */
export async function savePlaces(results: PlaceEnrichmentResponse[]): Promise<SavePlaceResult[]> {
  const response = await fetch('/api/places', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }),
  })
  return (await parseApiResponse<{ results: SavePlaceResult[] }>(response)).results
}

/** Lugares guardados en la base, del más reciente al más viejo. */
export async function listSavedPlaces(signal?: AbortSignal): Promise<PlaceListItem[]> {
  const response = await fetch('/api/places', { signal })
  return (await parseApiResponse<{ places: PlaceListItem[] }>(response)).places
}

/** Marca o desmarca un lugar guardado como destacado (curaduría manual). */
export async function setPlaceFeatured(id: string, featured: boolean, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/places/${encodeURIComponent(id)}/featured`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ featured }),
    signal,
  })
  await parseApiResponse<{ id: string; featured: boolean }>(response)
}

const EXISTS_CHUNK = 100

/** googlePlaceId que ya están en la base; consulta en tandas para no alargar demasiado la URL. */
export async function existingPlaceIds(ids: readonly string[], signal?: AbortSignal): Promise<Set<string>> {
  const unique = [...new Set(ids)]
  const chunks = Array.from({ length: Math.ceil(unique.length / EXISTS_CHUNK) }, (_, index) => unique.slice(index * EXISTS_CHUNK, (index + 1) * EXISTS_CHUNK))
  const found = await Promise.all(chunks.map(async (chunk) => {
    const response = await fetch(`/api/places/exists?ids=${chunk.map(encodeURIComponent).join(',')}`, { signal })
    return (await parseApiResponse<{ ids: string[] }>(response)).ids
  }))
  return new Set(found.flat())
}

/** Recorre un barrio completo y entrega cada evento NDJSON a medida que llega. */
export async function sweepNeighborhood(
  neighborhoodId: string,
  mode: NeighborhoodSweepMode,
  onEvent: (event: NeighborhoodSweepEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/neighborhoods/${encodeURIComponent(neighborhoodId)}/sweep`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
    signal,
  })
  if (!response.ok || !response.body) {
    await parseApiResponse<never>(response)
    throw new PlacesApiError('UNKNOWN_ERROR', 'No se pudo recorrer el barrio.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    const lines = buffer.split('\n')
    buffer = done ? '' : lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as NeighborhoodSweepEvent)
    }
    if (done) return
  }
}
