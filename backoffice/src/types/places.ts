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
  seedCategory: CategoryId
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
  data: JsonValue
  attribution: string
}

export type PlaceEnrichmentDraft = {
  name: string
  address: string
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
  moments: string[]
  cuisines: string[]
  foods: string[]
  drinks: string[]
  features: string[]
  goodFor: string[]
  dietary: {
    vegan: 'unknown' | 'no' | 'has_options' | 'fully'
    vegetarian: 'unknown' | 'no' | 'has_options' | 'fully'
    glutenFree: 'unknown' | 'no' | 'has_options' | 'fully'
  }
  price: 'unknown' | 'low' | 'moderate' | 'high' | 'very_high'
  reservations: 'unknown' | 'no_reservations' | 'accepts' | 'recommended'
  outdoorSeating: 'unknown' | 'yes' | 'no'
  hours: {
    raw: string | null
    display: { es: string; en: string } | null
    slots: { day: number; opens: string; closes: string | null }[]
    status: 'exact' | 'partial' | 'vague' | 'none'
    source: 'official' | 'third_party' | null
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
  description: { es: string; en: string }
  embeddingText: string
  keywordText: string
}

export type PlaceEnrichmentResponse = {
  source: 'openai'
  status: 'ok'
  model: 'gpt-5-mini'
  sourceAudit: PlaceExtractionSourceAudit
  performance: PlaceExtractionPerformance
  place: PlaceEnrichmentDraft
} | {
  source: 'openai'
  status: 'no_sources'
  model: 'gpt-5-mini'
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
  estimated: true
  totalUsd: number
  providers: {
    google: PlaceExtractionCostLine
    exa: PlaceExtractionCostLine & { contentPages: number }
    instagram: PlaceExtractionCostLine
    scraping: PlaceExtractionCostLine
    transit: PlaceExtractionCostLine
    llm: {
      inputTokens: number | null
      outputTokens: number | null
      inputCostUsd: number
      outputCostUsd: number
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
  | 'UNKNOWN_ERROR'

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode
    message: string
  }
}
import type { CategoryId } from '../data/tags.ts'
