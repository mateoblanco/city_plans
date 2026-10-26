import type { IconCategory } from '../data/icon-categories.ts'
import type { StyleId, TagId } from '../data/tags.ts'
import type { DIET_LEVELS, EditField, ManualLogo, ManualOverrides, PlaceEdit, PRICE_LEVELS } from '../data/manual-overrides.ts'
import type { ReviewReason } from '../data/review-reasons.ts'

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
  /** Seguidores del Instagram validado (en una sucursal de cadena, los de la marca); null sin Instagram. */
  igFollowers: number | null
  /** Sucursal de cadena: los seguidores son de la marca y la prominencia se descuenta. */
  chainBranch: boolean
}

/** Qué muestra la foto de perfil de Instagram: un logo, el local, comida, una persona u otra cosa. */
export type LogoKind = 'logo' | 'local' | 'food' | 'person' | 'other'

/** Por qué un lugar no tiene logo, o qué paso falló. */
export type LogoIssue =
  | 'no_instagram'
  | 'no_picture'
  | 'download_failed'
  | 'not_image'
  | 'too_small'
  | 'generic_avatar'
  | 'classification_failed'
  | 'processing_failed'
  | 'storage_not_configured'
  | 'upload_failed'
  /** Clasificada como persona: no se sube y el lugar queda sin logo. */
  | 'person_photo'

/** Logo guardado en R2: key es la clave del bucket (la URL la arma LOGO_BASE_URL). Colores en hex #rrggbb. */
export type PlaceLogo = {
  key: string
  kind: LogoKind | null
  bgColor: string | null
  color: string | null
  source: 'instagram' | 'owner' | 'manual'
  fetchedAt: string
}

export type PlaceEnrichmentDraft = {
  name: string
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
    instagram: string | null
    website: string | null
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
  /** Foto de perfil del Instagram validado, procesada y subida a R2; null sin Instagram o si algún paso falló. */
  logo: PlaceLogo | null
  /** Clave de shared/icon-categories.ts: por qué es conocido el lugar. La elige el LLM; null = todavía sin categoría. */
  iconCategory: IconCategory | null
  /** Estilo de la marca (casual, intermedio, cuidado); null sin señales suficientes. Falta en resultados de antes. */
  style?: StyleId | null
  /** Motivos para guardarlo con status review en vez de published; vacío = se publica. Falta en resultados de antes. */
  reviewReasons?: ReviewReason[]
  /**
   * Cómo quedó cada momento (goodFor), cozy y el style: explicit si la fuente lo nombra, inferred por señales.
   * Sólo para auditar; no se guarda en la base.
   */
  tagEvidence?: TagEvidence[]
  embeddingText: string
  keywordText: string
}

export type TagEvidence = {
  /** Id del tag o del style. */
  tag: string
  mode: 'explicit' | 'inferred'
  /** Sólo style: de dónde salió (señales en los facts, el precio o el ícono). */
  basis?: 'signals' | 'price' | 'icon'
  /** Señal o frase que lo justificó. */
  signals: string[]
  factIds: string[]
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
  /** Paso del logo: ok, sin logo (missing: no había foto usable) o failed (falló la clasificación o la subida). */
  logo: { status: 'ok' | 'missing' | 'failed'; reason: LogoIssue | null; kind: LogoKind | null; detail?: string | null }
  /**
   * Reintentos por servicio: por 429 (retries) y por timeout o error pasajero (transientRetries, sólo Apify),
   * espera total y si se recuperó. Sin recuperar, Exa queda fuera de las fuentes; Apify y el LLM terminan con
   * error. Falta en resultados de antes.
   */
  rateLimits?: { service: 'apify' | 'exa' | 'llm'; retries: number; waitedMs: number; recovered: boolean; transientRetries?: number }[]
  /**
   * Desempate entre varios perfiles de Instagram válidos: la regla que eligió, o unresolved si siguió el empate,
   * y los handles empatados. Falta si no hubo empate.
   */
  instagramTieBreak?: { rule: InstagramTieBreakRule; handles: string[] }
  /**
   * Cuentas de Instagram descartadas por ser candidatas (o estar guardadas) en lugares de otra marca: agregadoras.
   * places son los googlePlaceId de esos otros lugares; el lote re-procesa los suyos que la hayan elegido.
   */
  instagramShared?: { handle: string; places: string[] }[]
  /**
   * Instagram cargado a mano en la revisión (handle) o marcado "No tiene Instagram" (null). Al guardar entra en
   * manual_overrides para que un reproceso no lo pise. Falta si el Instagram salió del pipeline.
   */
  instagramManual?: { handle: string | null }
  /**
   * Salida estructurada del modelo (PlaceExtraction de server/providers/place-extraction-service.ts) con la que se
   * armó el place, para volver a correr postProcess sin pagar el LLM. No va al reporte. Falta en resultados de antes.
   */
  llmOutput?: unknown
}

/**
 * Reglas de desempate entre perfiles de Instagram válidos, en orden: único con rubro gastronómico, foto de perfil
 * real, post más reciente, más seguidores. unresolved: siguió el empate.
 */
export type InstagramTieBreakRule = 'gastronomy' | 'profile_picture' | 'latest_post' | 'followers' | 'unresolved'

/** Instagram con el que sigue el paso 2: el que validó el pipeline, uno cargado a mano o ninguno. */
export type InstagramChoice = { mode: 'auto' } | { mode: 'manual'; handle: string } | { mode: 'none' }

/**
 * approved: la validación eligió un perfil con señales de negocio. doubtful: lo eligió sólo por el nombre o el
 * handle, hubo empate sin resolver o rechazó todos los candidatos. none: no hubo candidatos.
 */
export type InstagramDiscoveryStatus = 'approved' | 'doubtful' | 'none'

/** Resultado del paso 1 (POST /api/extract/discover) para la revisión del Instagram. */
export type InstagramDiscovery = {
  googlePlaceId: string
  status: InstagramDiscoveryStatus
  /** El elegido (approved) o el mejor candidato (doubtful); null sin candidatos. */
  handle: string | null
  /** Por qué es dudoso; null si no lo es. */
  doubt: 'name_only' | 'tie' | 'rejected' | null
  /** Los candidatos con la decisión de la validación. */
  candidates: { handle: string; decision: InstagramAuditCandidate['decision']; reason: string }[]
  /** Instagram cargado a mano en un procesamiento anterior (manual_overrides): handle, o null si no tiene. */
  saved?: { handle: string | null }
  /** Cuentas descartadas por ser candidatas de lugares de otra marca, con esos lugares (como review.instagramShared). */
  shared?: { handle: string; places: string[] }[]
  costUsd: number
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
  /** Clasificación del logo. */
  logoUsd: number
  /** Tokens de entrada del llamado principal: total, leídos del cache y escritos en el cache. */
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
}

export type ExtractionReportRequest = {
  /** reviewReasons: motivos para guardarlo con status review (vacío o ausente = se publica). */
  places: { name: string; googlePlaceId: string; stats: ExtractionReportStats; review: PlaceReview | null; reviewReasons?: ReviewReason[] }[]
  /** googlePlaceId de los que no se procesaron por un error de Apify. */
  apifyErrors?: string[]
  /** El lote se cortó por errores de Apify seguidos. */
  stoppedByApify?: boolean
  /** googlePlaceId de los que no se procesaron por un error de Exa. */
  exaErrors?: string[]
  /** El lote se cortó por errores de Exa seguidos. */
  stoppedByExa?: boolean
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
  igFollowers: number | null
  /** Marca con sucursales (server/places/brand-key.ts); null sin marca. */
  brandKey: string | null
  /** Handle sin @ ni mayúsculas; null sin Instagram. */
  instagram: string | null
  featured: boolean
  logoUrl: string | null
  logoKind: LogoKind | null
  logoBgColor: string | null
  logoColor: string | null
  iconCategory: IconCategory | null
  style: StyleId | null
  reviewReasons: ReviewReason[]
  /** Campos editados a mano (manual_overrides), sin Publicar. */
  editedFields: EditField[]
}

export const PLACE_LIST_CATEGORIES = ['restaurant', 'bar', 'cafe'] as const
export const PLACE_LIST_SORTS = ['recent', 'prominence', 'name'] as const

/** Filtros, orden y página de GET /api/places. */
export type PlaceListQuery = {
  q?: string
  neighborhood?: string
  category?: (typeof PLACE_LIST_CATEGORIES)[number]
  status?: 'published' | 'review'
  edited?: boolean
  /** Sin logo_key. */
  noLogo?: boolean
  /** Horario con status none ("Sin horario"). */
  noHours?: boolean
  sort: (typeof PLACE_LIST_SORTS)[number]
  page: number
  pageSize: number
}

/** Una página del listado. total: con todos los filtros; counts: con los filtros salvo el status (para las pestañas). */
export type PlaceListPage = {
  places: PlaceListItem[]
  total: number
  counts: { all: number; published: number; review: number }
}

/** Lo que el modal de edición necesita de un lugar (GET /api/places/:id). */
export type PlaceDetail = {
  id: string
  googlePlaceId: string | null
  name: string
  neighborhoodId: string
  status: string
  categories: string[]
  tags: TagId[]
  style: StyleId | null
  iconCategory: IconCategory | null
  price: PriceLevel
  dietVegan: DietLevel
  dietVegetarian: DietLevel
  dietGlutenFree: DietLevel
  instagram: string | null
  website: string | null
  brandKey: string | null
  featured: boolean
  logoUrl: string | null
  logoKind: LogoKind | null
  logoBgColor: string | null
  logoColor: string | null
  logoSource: PlaceLogo['source'] | null
  igFollowers: number | null
  prominence: number
  manualOverrides: ManualOverrides
  editedFields: EditField[]
  /** brand_key de todos los lugares guardados, para sugerir en el modal. */
  brandKeys: string[]
}

export type PriceLevel = (typeof PRICE_LEVELS)[number]
export type DietLevel = (typeof DIET_LEVELS)[number]

/** Otro lugar guardado que ya tiene el Instagram que se quiere poner. */
export type InstagramOwner = { id: string; name: string; neighborhoodId: string; brandKey: string | null }

/** Qué se recalcula al guardar una edición y cuánto cuesta (PATCH /api/places/:id con dryRun). */
export type PlaceEditPlan = {
  /** Campos que cambian respecto de lo guardado. */
  changed: (keyof PlaceEdit)[]
  /** Pasos del recálculo, en el orden en que corren, con su costo (0 = sin llamadas pagas). */
  steps: { id: 'search_texts' | 'embedding' | 'instagram_profile' | 'logo_classification' | 'prominence' | 'brand_keys' | 'column_only'; label: string; costUsd: number }[]
  totalUsd: number
  /** Otros lugares con el Instagram nuevo: hay que confirmar (puede ser otra sucursal). */
  instagramOwners: InstagramOwner[]
}

/** Resultado de guardar una edición. warnings: lo que no se pudo recalcular (el resto quedó guardado). */
export type PlaceEditResult = { place: PlaceDetail; warnings: string[] }

/** Resultado de borrar un lugar: qué se limpió y qué quedó para después. */
export type PlaceDeleteResult = {
  id: string
  /** Snapshot movido a cache/extractions/deleted/, o null si no había. */
  snapshot: string | null
  /** Otros lugares cuya brand_key cambió al sacar este del grupo. */
  brandKeys: { id: string; name: string; brandKey: string | null }[]
  /** El logo queda en R2 hasta yarn logos:cleanup. */
  logoKey: string | null
}

/** Logo subido a mano, procesado y en R2 (todavía sin guardar en el lugar). */
export type ManualLogoUpload = { logo: ManualLogo; logoUrl: string | null; classificationUsd: number }

export type PlaceEnrichmentResponse = {
  source: 'llm'
  status: 'ok'
  model: string
  review: PlaceReview
  sourceAudit: PlaceExtractionSourceAudit
  performance: PlaceExtractionPerformance
  place: PlaceEnrichmentDraft
  /** URL pública de place.logo (LOGO_BASE_URL + key), para la miniatura en Procesados. */
  logoUrl?: string | null
} | {
  source: 'llm'
  status: 'no_sources'
  model: string
  sourceAudit: PlaceExtractionSourceAudit
  performance: PlaceExtractionPerformance
  /** address es la de Google: sólo para identificar el local, no se guarda. */
  target: Pick<PlaceEnrichmentDraft, 'name' | 'coordinates' | 'neighborhoodId' | 'city' | 'googlePlaceId' | 'transit'> & { address: string }
}

/** De dónde salió un handle candidato. */
export type InstagramCandidateOrigin =
  | 'exa_profile_field'
  | 'exa_contact_info'
  | 'exa_result'
  | 'website'
  | 'exa_instagram_search'
  /** Cargado a mano en la revisión. */
  | 'manual'

/** Qué regla aceptó o rechazó el perfil que trajo Apify. */
export type InstagramMatchRule =
  | 'handle_exact'
  | 'handle_location'
  | 'handle_category'
  | 'name_and_local_signal'
  | 'name_and_address'
  | 'name_and_website_link'
  | 'brand_word_and_address'
  | 'brand_word_and_phone'
  | 'mismatch_overridden_by_phone'
  | 'mismatch_overridden_by_website_link'
  /** Es el Instagram que Google tiene como web del lugar (sólo confirma un candidato de otra fuente). */
  | 'google_website_match'
  | 'foreign_profile'
  | 'non_gastronomy_profile'
  | 'other_address_in_bio'
  /** Aceptado sólo por el nombre, sin señales de negocio y con la foto de una persona. */
  | 'personal_account'
  | 'no_identity_signal'

export type InstagramAuditCandidate = {
  handle: string
  decision: 'selected' | 'discarded' | 'unavailable'
  reason: string
  /** Fuentes que lo propusieron. Falta en respuestas de antes. */
  origins?: InstagramCandidateOrigin[]
  /** Regla de validación que lo aceptó o rechazó (sólo si Apify trajo el perfil). */
  rule?: InstagramMatchRule
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
  stepsMs: Partial<Record<'google' | 'exa' | 'scraping' | 'instagram' | 'logo' | 'llm' | 'transit', number>>
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
    /** Clasificación de la foto de perfil con un modelo chico con visión. */
    logo?: {
      model: string
      inputTokens: number | null
      outputTokens: number | null
      gatewayCostUsd: number | null
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
  /** Ya no se pide a Exa (el schema admite 10 propiedades); queda en snapshots viejos. */
  knows_before_you_go?: string
  menu: string[]
  /** URL del perfil de Instagram que Exa encontró en las fuentes; vacío si no apareció. Falta en snapshots viejos. */
  instagram_profile_url?: string
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
  /** Apify no pudo traer Instagram en /api/extract: el lugar no se procesó y hay que reintentarlo. */
  | 'INSTAGRAM_PROVIDER_ERROR'
  /** Exa no respondió en /api/extract: el lugar no se procesó y hay que reintentarlo. */
  | 'EXA_PROVIDER_ERROR'
  /** El Instagram cargado a mano no existe (handle mal escrito): se corrige en la revisión. */
  | 'INSTAGRAM_NOT_FOUND'
  /** El paso 2 no encontró el descubrimiento del lugar (venció o se reinició el server): hay que volver a descubrir. */
  | 'DISCOVERY_EXPIRED'
  | 'NOT_FOUND_ERROR'
  /** El Instagram que se edita ya lo tiene otro lugar: hay que confirmar que es otra sucursal. */
  | 'INSTAGRAM_IN_USE'
  /** El logo subido no sirve (no es imagen, es muy chico, es el avatar genérico). */
  | 'LOGO_INVALID'
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
  /** Sólo en memoria, para el mapa. null en modo sólo IDs. */
  location: { lat: number; lng: number } | null
  /** placeId de los lugares que lo contienen (un mercado, un shopping). Sólo para mostrar; Google no trae el nombre. */
  containedIn: string[]
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
