export type JsonPrimitive = string | number | boolean | null

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }

export type PlaceSummary = {
  placeId: string
  name: string
  type: string
  googleMapsUri: string
  seedCategories: CategoryId[]
}

export type FilterPlacesSearchRequest = {
  mode: 'filters'
  barrio: string
  placeType: string
  pageToken?: string
}

export type TextPlacesSearchRequest = {
  mode: 'text'
  query: string
  seedCategory: CategoryId
  pageToken?: string
}

export type PlacesSearchRequest =
  | FilterPlacesSearchRequest
  | TextPlacesSearchRequest

export type PlacesSearchResponse = {
  items: PlaceSummary[]
  nextPageToken: string | null
}

export type PlaceAnchor = {
  name: string
  address: string
  latitude: number
  longitude: number
}

export type GooglePlaceDetailsResponse = {
  source: 'google'
  exactMatch: true
  anchor: PlaceAnchor
  websiteUri: string | null
  phoneNumber?: string | null
  /** primaryTypeDisplayName en español; sólo para armar consultas, no se guarda. */
  placeType?: string | null
  data: JsonValue
  attribution: string
}

/** Señales de prominencia que salen de las fuentes; el puntaje se calcula al guardar. */
export type PlaceSignals = {
  /** Fuentes editoriales distintas (por dominio) que nombran al lugar. */
  editorialMentions: number
  /** Alguna de esas fuentes es un ranking o menciona un premio. */
  listedOrAwarded: boolean
  /** Seguidores del Instagram validado; null sin Instagram o en una sucursal de cadena. */
  igFollowers: number | null
}

export type PlaceEnrichmentDraft = {
  name: string
  address: string | null
  coordinates: {
    lat: number
    lng: number
    source: 'osm' | 'google' | 'manual'
    fetchedAt: string
  }
  neighborhoodId: string | null
  city: 'Montevideo'
  googlePlaceId: string
  transit: {
    status: 'success' | 'partial' | 'unavailable'
    lines: { line: string; stopId: string; meters: number }[]
  }
  categories: string[]
  /** Ids de tags.ts de todos los grupos salvo categories y dietary. */
  tags: string[]
  dietary: {
    vegan: 'unknown' | 'no' | 'has_options' | 'fully'
    vegetarian: 'unknown' | 'no' | 'has_options' | 'fully'
    glutenFree: 'unknown' | 'no' | 'has_options' | 'fully'
  }
  price: 'unknown' | 'low' | 'moderate' | 'high' | 'very_high'
  reservations: 'unknown' | 'no_reservations' | 'accepts' | 'recommended'
  hours: {
    raw: string | null
    display: { es: string; en: string } | null
    slots: { day: number; opens: string; closes: string | null }[]
    status: 'exact' | 'partial' | 'vague' | 'none'
    source: 'official' | 'third_party' | null
    /** Por qué no hay horario; la UI muestra entonces el horario de Google en vivo. null si hay horario. */
    missingReason: 'chain_branch_not_found' | 'no_data' | null
  }
  contact: {
    phone: string | null
    whatsapp: string | null
    instagram: string | null
    website: string | null
    menuUrl: string | null
    reservationUrl: string | null
  }
  highlights: { es: string; en: string }[]
  /** Platos concretos de las fuentes, en español y minúscula; cada uno respaldado por un fact. Máx. 15. */
  dishes: string[]
  /** Hasta 3 ids de tags que definen al lugar; todos están también en tags. */
  signature: string[]
  description: { es: string; en: string }
  /** Nombre del lugar que contiene al local (mercado, shopping, galería…); null si las fuentes no lo dicen. */
  locatedIn: string | null
  /** Para auditar en el backoffice de dónde sale cada dato; no entra en embeddingText ni keywordText. */
  placeFacts: PlaceFact[]
  signals: PlaceSignals
  embeddingText: string
  keywordText: string
}

export type PlaceFactKind = 'food' | 'drink' | 'feature' | 'hours' | 'dietary' | 'price' | 'reservations' | 'contact' | 'other'

/** Hecho concreto que el LLM leyó en una fuente; supports son los campos del borrador que lo citan. */
export type PlaceFact = {
  /** Id que le dio el modelo (F1, F2…); los tags y support lo citan. */
  id: string
  text: string
  kind: PlaceFactKind
  sourceId: string
  sourceUrl: string
  trust: 'official' | 'third_party'
  supports: string[]
}

export type PlaceReviewAnomalyType =
  | 'hours_vague'
  | 'hours_no_close'
  | 'bar_without_drinks'
  | 'restaurant_without_food'
  | 'dietary_fully'
  | 'no_contact'
  | 'cuisine_unmentioned'

export type PlaceReviewAnomaly = { type: PlaceReviewAnomalyType; detail: string }

/** Lo que el pipeline no resolvió en un lugar; se junta por lote en el reporte. */
export type PlaceReview = {
  /**
   * Facts que ningún tag, campo, horario ni highlight cita. proposedTag es el id que el modelo
   * propone (existente o nuevo en snake_case), o null si el fact no sirve para buscar.
   */
  unmappedFacts: { id: string; text: string; proposedTag: string | null }[]
  /** Lo que el modelo no supo encasillar (máx. 5). */
  doubts: string[]
  anomalies: PlaceReviewAnomaly[]
  /** Segunda búsqueda de horarios en Exa (cadenas); costUsd suma Exa y el LLM de ese paso. */
  hoursRetry: { attempted: boolean; recovered: boolean; costUsd: number }
}

/** Datos de cada lugar procesado para el resumen del lote. */
export type ExtractionReportStats = {
  hoursStatus: PlaceEnrichmentDraft['hours']['status']
  hasInstagram: boolean
  hasWebsite: boolean
  tagCount: number
  costUsd: number
  totalMs: number
  /** costUsd separado por etapa: fuentes, LLM principal y segunda búsqueda de horarios. */
  sourcesUsd: number
  mainLlmUsd: number
  hoursRetryUsd: number
  /** Tokens de entrada del llamado principal: total, leídos del cache y escritos en el cache. */
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
}

export type ExtractionReportRequest = {
  places: { name: string; googlePlaceId: string; stats: ExtractionReportStats; review: PlaceReview | null }[]
}

/** Respuesta de POST /api/places por cada lugar enviado. */
export type SavePlaceResult = {
  googlePlaceId: string
  id: string | null
  action: 'created' | 'updated' | 'skipped'
  embedded: boolean
  error?: string
}

/** Fila del listado de lugares guardados (GET /api/places). */
export type PlaceListItem = {
  id: string
  name: string
  neighborhoodId: string
  categories: string[]
  tags: string[]
  status: string
  hoursStatus: string
  updatedAt: string
  hasEmbedding: boolean
  prominence: number
  editorialMentions: number
  listedOrAwarded: boolean
  igFollowers: number | null
  featured: boolean
}

export type PlaceEnrichmentResponse = {
  source: 'llm'
  status: 'ok'
  model: string
  review: PlaceReview
  sourceAudit: PlaceExtractionSourceAudit
  performance: PlaceExtractionPerformance
  place: PlaceEnrichmentDraft
} | {
  source: 'llm'
  status: 'no_sources'
  model: string
  sourceAudit: PlaceExtractionSourceAudit
  performance: PlaceExtractionPerformance
  target: Pick<PlaceEnrichmentDraft, 'name' | 'address' | 'coordinates' | 'neighborhoodId' | 'city' | 'googlePlaceId' | 'transit'>
}

export type InstagramAuditCandidate = {
  handle: string
  decision: 'selected' | 'discarded' | 'unavailable'
  reason: string
}

export type PlaceExtractionSourceAudit = {
  google: boolean
  exa: boolean
  instagram: boolean
  instagramCandidates: string[]
  instagramSelection: {
    handle: string | null
    origin: 'official_profile' | 'exa_summary' | 'exa_result' | 'llm_evidence' | null
    candidates: InstagramAuditCandidate[]
  }
}

export type PlaceExtractionPerformance = {
  totalMs: number
  stepsMs: Partial<Record<'google' | 'exa' | 'scraping' | 'instagram' | 'llm' | 'transit', number>>
  sourceText: {
    beforeChars: number
    afterChars: number
    estimatedInputTokensBefore: number
    estimatedInputTokensAfter: number
    estimatedInputTokensSaved: number
  }
  inputTokens: number | null
  outputTokens: number | null
  costUsd: PlaceExtractionCost
}

export type PlaceExtractionCostLine = {
  requests: number
  costUsd: number
}

export type PlaceExtractionCost = {
  currency: 'USD'
  /** false cuando el costo del LLM sale del uso real de tokens y del precio conocido del modelo. */
  estimated: boolean
  totalUsd: number
  providers: {
    google: PlaceExtractionCostLine
    exa: PlaceExtractionCostLine & { contentPages: number; highlightPages: number }
    instagram: PlaceExtractionCostLine
    scraping: PlaceExtractionCostLine
    transit: PlaceExtractionCostLine
    llm: {
      model: string
      inputTokens: number | null
      cachedInputTokens: number | null
      cacheWriteTokens: number | null
      outputTokens: number | null
      /** Costo informado por el AI Gateway, para contrastar con el calculado. */
      gatewayCostUsd: number | null
      inputCostUsd: number
      outputCostUsd: number
      costUsd: number
    }
    /** Segundo llamado al LLM, sólo para el horario de la sucursal. */
    hoursRetry?: {
      model: string
      inputTokens: number | null
      outputTokens: number | null
      costUsd: number
    }
  }
}

export type ExaPlaceInfo = {
  description: string
  address: string
  contact_info: string
  open_hours_raw: string
  open_hours: { days: string; opens: string; closes: string | null }[]
  knows_before_you_go: string
  menu: string[]
}

export type ExaPlaceResult = {
  title: string
  url: string
  highlights: string[]
  text?: string
  extras?: { links?: string[] }
}

export type ExaPlaceResponse = {
  source: 'exa'
  query: string
  output: {
    content: ExaPlaceInfo
    grounding: JsonValue
  }
  results: ExaPlaceResult[]
  requestId: string
  attribution: string
}

export type MatchSource = 'overture' | 'openstreetmap'

export type PlaceMatchCandidate = {
  latitude: number
  longitude: number
  score: number
  distanceMeters: number
  matchEvidence: {
    anchorName: string
    candidateName: string
    normalizedAnchorName: string
    normalizedCandidateName: string
    nameSimilarity: number
    proximityScore: number
    addressSimilarity: number
  }
  data: JsonValue
}

export type PlaceMatchResponse = {
  source: MatchSource
  matchMethod: 'spatial_name_v2'
  bestMatch: PlaceMatchCandidate | null
  candidates: PlaceMatchCandidate[]
  attribution: string
}

export type SourceMatchRequest = {
  anchor: PlaceAnchor
}

export type ApiErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'VALIDATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'QUOTA_ERROR'
  | 'TIMEOUT_ERROR'
  | 'UPSTREAM_ERROR'
  | 'NOT_FOUND_ERROR'
  | 'UNKNOWN_ERROR'

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode
    message: string
  }
}
export type PlaceGroup = 'accepted' | 'review' | 'rejected'

export type NeighborhoodSweepPlace = PlaceSummary & {
  googleTypes: string[]
  foundBy: string[]
  /** null en modo sólo IDs: sin ubicación no se puede saber. */
  insideNeighborhood: boolean | null
  /** Filtro previo al pipeline. null en modo sólo IDs: no trae businessStatus ni primaryType. */
  group: PlaceGroup | null
  reason: string | null
  primaryType: string | null
  /** Sólo para mostrar en pantalla, no se guardan. userRatingCount interviene en el filtro previo; rating no. */
  rating: number | null
  userRatingCount: number | null
}

export type SweepBounds = {
  south: number
  west: number
  north: number
  east: number
}

export type SweepCallCounts = {
  sweep: number
  rescue: number
}

export type SaturatedCell = {
  bounds: SweepBounds
  saturatedBy: { googleType: string; query: string }[]
  rescueNewPlaces: number
}

export type FailedSweepCall = {
  key: string
  bounds: SweepBounds
  /** 1 = primera página; mayor que 1 = página intermedia pedida con nextPageToken. */
  page: number
  message: string
}

/** full: Text Search Pro con filtro por polígono. ids: Essentials (IDs Only), gratis y sin filtro. */
export type NeighborhoodSweepMode = 'full' | 'ids'

export type NeighborhoodSweepSummary = {
  neighborhoodId: string
  mode: NeighborhoodSweepMode
  totalPlaces: number
  bySeedCategory: Partial<Record<CategoryId, number>>
  /** Lugares dentro del barrio por grupo del filtro previo. null en modo sólo IDs. */
  byGroup: Record<PlaceGroup, number> | null
  byReason: Record<string, number>
  /** Tipos primarios en review por unknown_type, con cantidad de lugares, para pasarlos a ACCEPT o REJECT. */
  unknownTypes: Record<string, number>
  newByQuery: Record<string, number>
  saturatedCells: SaturatedCell[]
  discardedOutside: number
  apiCalls: SweepCallCounts
  failedCalls: FailedSweepCall[]
  /** Llamadas que fallaron después de todos los reintentos. */
  failedCallCount: number
  /** De esas, las que eran páginas intermedias (nextPageToken). */
  failedPageCount: number
  truncated: boolean
  maxCalls: number
}

export type NeighborhoodSweepEvent =
  | { type: 'start'; neighborhoodId: string; mode: NeighborhoodSweepMode; maxCalls: number }
  | { type: 'progress'; apiCalls: SweepCallCounts; totalPlaces: number; discardedOutside: number; currentQuery: string }
  | { type: 'places'; items: NeighborhoodSweepPlace[] }
  | { type: 'done'; summary: NeighborhoodSweepSummary }
  | { type: 'error'; error: ApiErrorResponse['error'] }

import type { CategoryId } from '../data/tags.ts'
