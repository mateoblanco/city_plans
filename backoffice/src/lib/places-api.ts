import type {
  ApiErrorResponse,
  ExaPlaceResponse,
  ExtractionReportRequest,
  GooglePlaceDetailsResponse,
  InstagramChoice,
  InstagramDiscovery,
  MatchSource,
  NeighborhoodSweepEvent,
  NeighborhoodSweepMode,
  PlaceAnchor,
  InstagramOwner,
  ManualLogoUpload,
  PlaceDeleteResult,
  PlaceDetail,
  PlaceEditPlan,
  PlaceEditResult,
  PlaceEnrichmentResponse,
  PlaceListPage,
  PlaceListQuery,
  PlaceMatchResponse,
  PlaceSummary,
  PlacesSearchRequest,
  PlacesSearchResponse,
  SavePlaceResult,
} from '@/types/places'
import type { PlaceEdit } from '@/data/manual-overrides'

export class PlacesApiError extends Error {
  readonly code: ApiErrorResponse['error']['code']
  /** Con INSTAGRAM_IN_USE: los otros lugares que ya tienen ese Instagram. */
  readonly owners: InstagramOwner[]

  constructor(
    code: ApiErrorResponse['error']['code'],
    message: string,
    owners: InstagramOwner[] = [],
  ) {
    super(message)
    this.name = 'PlacesApiError'
    this.code = code
    this.owners = owners
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
    const owners = payload && typeof payload === 'object' && 'owners' in payload && Array.isArray(payload.owners) ? payload.owners as InstagramOwner[] : []
    throw new PlacesApiError(
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? 'No se pudo completar la consulta.',
      owners,
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

/** Paso 1 del procesamiento con revisión: el servidor guarda las fuentes y devuelve el Instagram para revisar. */
export async function discoverPlace(
  request: ExtractRequest,
  signal?: AbortSignal,
): Promise<InstagramDiscovery> {
  const response = await fetch('/api/extract/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  return parseApiResponse<InstagramDiscovery>(response)
}

/** Paso 2: la extracción con las fuentes del paso 1 y el Instagram elegido en la revisión. */
export async function completePlace(
  googlePlaceId: string,
  instagram: InstagramChoice,
  signal?: AbortSignal,
): Promise<PlaceEnrichmentResponse> {
  const response = await fetch('/api/extract/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ googlePlaceId, instagram }),
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

/** Query string de GET /api/places, sin los valores por defecto. */
export function placeListSearch(query: PlaceListQuery): string {
  const params = new URLSearchParams()
  if (query.q?.trim()) params.set('q', query.q.trim())
  if (query.neighborhood) params.set('neighborhood', query.neighborhood)
  if (query.category) params.set('category', query.category)
  if (query.status) params.set('status', query.status)
  if (query.edited) params.set('edited', '1')
  if (query.noLogo) params.set('noLogo', '1')
  if (query.noHours) params.set('noHours', '1')
  if (query.sort !== 'recent') params.set('sort', query.sort)
  if (query.page !== 1) params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))
  return params.toString()
}

/** Una página de los lugares guardados, con filtros y orden en el servidor. */
export async function listSavedPlaces(query: PlaceListQuery, signal?: AbortSignal): Promise<PlaceListPage> {
  const response = await fetch(`/api/places?${placeListSearch(query)}`, { signal })
  return parseApiResponse<PlaceListPage>(response)
}

/** Lo que el modal de edición necesita de un lugar. */
export async function getPlaceDetail(id: string, signal?: AbortSignal): Promise<PlaceDetail> {
  const response = await fetch(`/api/places/${encodeURIComponent(id)}`, { signal })
  return (await parseApiResponse<{ place: PlaceDetail }>(response)).place
}

/** Qué se recalcula al guardar la edición y cuánto cuesta, sin guardar. */
export async function planPlaceEdit(id: string, edit: PlaceEdit, signal?: AbortSignal): Promise<PlaceEditPlan> {
  const response = await fetch(`/api/places/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edit, dryRun: true }),
    signal,
  })
  return (await parseApiResponse<{ plan: PlaceEditPlan }>(response)).plan
}

/** Guarda la edición. confirmSharedInstagram: el Instagram ya lo tiene otro lugar y se confirmó que es otra sucursal. */
export async function savePlaceEdit(id: string, edit: PlaceEdit, options: { confirmSharedInstagram?: boolean } = {}): Promise<PlaceEditResult> {
  const response = await fetch(`/api/places/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ edit, ...options }),
  })
  return parseApiResponse<PlaceEditResult>(response)
}

/** Sube un logo: el servidor lo procesa y lo deja en R2; se guarda en el lugar con la edición. */
export async function uploadPlaceLogo(id: string, file: File): Promise<ManualLogoUpload> {
  const response = await fetch(`/api/places/${encodeURIComponent(id)}/logo`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  return parseApiResponse<ManualLogoUpload>(response)
}

/** Borra el lugar de la base. */
export async function deleteSavedPlace(id: string): Promise<PlaceDeleteResult & { warnings: string[] }> {
  const response = await fetch(`/api/places/${encodeURIComponent(id)}`, { method: 'DELETE' })
  return parseApiResponse<PlaceDeleteResult & { warnings: string[] }>(response)
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

/** Publica a mano un lugar que quedó en revisión. */
export async function publishPlace(id: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`/api/places/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'published' }),
    signal,
  })
  await parseApiResponse<{ id: string; status: 'published' }>(response)
}

/** googlePlaceId que ya están en la base: una sola request (y una sola consulta) con todos los ids. */
export async function existingPlaceIds(ids: readonly string[], signal?: AbortSignal): Promise<Set<string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Set()
  const response = await fetch('/api/places/exists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: unique }),
    signal,
  })
  return new Set((await parseApiResponse<{ ids: string[] }>(response)).ids)
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
