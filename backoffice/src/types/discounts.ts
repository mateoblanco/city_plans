// Fuente única compartida con la app de Next: ver /shared/discounts.ts.
export * from '../../../shared/discounts.ts'
import type { DiscountsResponse } from '../../../shared/discounts.ts'

// ── Sólo backoffice: búsqueda en Google de los lugares que no están en la base ──

/**
 * Estado guardado de la búsqueda de un local (discount_places.place_searches). searched: se empezó a buscar (si no hay
 * una búsqueda en curso, quedó interrumpida); review: se extrajo y quedó en "A revisar"; doubtful: varios resultados
 * posibles o ninguno claro, para elegir; not_found: nada en Google (o "Ninguno"); exists: el lugar de Google ya está en
 * la base; error: falló (se puede volver a buscar).
 */
export const PLACE_SEARCH_STATUSES = ['searched', 'review', 'doubtful', 'not_found', 'exists', 'error'] as const
export type PlaceSearchStatus = (typeof PLACE_SEARCH_STATUSES)[number]

/** Un resultado posible de Google: sólo place_id y coordenadas (lo único que se guarda de Google). */
export type PlaceSearchCandidate = { placeId: string; lat: number; lng: number }

/** Lo guardado por local. De Google, sólo place_id y coordenadas. */
export type DiscountPlaceSearch = {
  /** locations[i] del lugar del proveedor; null si la fuente no da direcciones (Itaú). */
  locationIndex: number | null
  status: PlaceSearchStatus
  searchedAt: string
  /** El elegido (review, exists). */
  googlePlaceId: string | null
  location: { lat: number; lng: number } | null
  /** Hasta 3, en los dudosos. */
  candidates: PlaceSearchCandidate[]
  /** Nuestro lugar (uuid), en review y exists. */
  placeId: string | null
  error: string | null
}

export const OUR_PLACE_STATUSES = ['draft', 'published', 'review', 'hidden'] as const
export type OurPlaceStatus = (typeof OUR_PLACE_STATUSES)[number]

/** Al leer, con nuestro lugar como está hoy (el status puede haber cambiado desde la búsqueda). */
export type StoredPlaceSearch = DiscountPlaceSearch & { ourPlace: { id: string; name: string; status: OurPlaceStatus } | null }

/** Un local de un lugar del proveedor que no está en la base (vista "No están en la base"). */
export type MissingMember = {
  key: string
  discountPlaceId: string
  providerId: string
  /** locations[i]; null si la fuente no da direcciones de Montevideo (Itaú). */
  locationIndex: number | null
  sourceName: string
  neighborhoodId: string | null
  address: string | null
  coordinates: { lat: number; lng: number } | null
  sourceUrl: string
}

/** Una fila de "No están en la base": locales de uno o varios proveedores que son el mismo lugar (server/discounts/missing.ts). */
export type MissingRow = {
  /** Estable mientras no cambien los locales que la forman. */
  key: string
  name: string
  normalized: string
  neighborhoodId: string | null
  /** Todos los locales que se juntaron (también los sin barrio que se sumaron). */
  members: MissingMember[]
  /** Los que reciben el estado de la búsqueda: los que tienen barrio, o todos si la fila no tiene barrio. */
  owners: MissingMember[]
  providerIds: string[]
  /** Para la búsqueda en Google: coordenadas, si no dirección, si no el barrio. */
  coordinates: { lat: number; lng: number } | null
  address: string | null
}

/**
 * GET /api/discounts en el backoffice: lo de siempre, las búsquedas guardadas por lugar del proveedor y las filas de
 * "No están en la base" (se arman en el servidor: el barrio por coordenadas necesita los polígonos, que no van al navegador).
 */
export type DiscountsListResponse = DiscountsResponse & { searches: Record<string, StoredPlaceSearch[]>; missing: MissingRow[] }

/** Nombre y dirección de Google de un candidato: sólo en memoria del servidor (nunca en la base ni en disco). */
export type CandidateDetail = { name: string; address: string }

/** Una fila del trabajo de búsqueda en curso (o del último). */
export type PlaceSearchJobRow = {
  rowKey: string
  name: string
  neighborhoodId: string | null
  providerIds: string[]
  state: 'queued' | 'searching' | 'extracting' | 'done'
  /** El resultado, cuando state es done. */
  outcome: Exclude<PlaceSearchStatus, 'searched'> | null
  candidates: PlaceSearchCandidate[]
  /** Distancia de cada candidato al local de la fuente (si la fuente da coordenadas). */
  candidateMeters: Record<string, number>
  googlePlaceId: string | null
  ourPlace: StoredPlaceSearch['ourPlace']
  error: string | null
  costUsd: number
}

export type PlaceSearchProgress =
  | { status: 'idle' }
  | {
      status: 'running' | 'done'
      jobId: string
      startedAt: string
      finishedAt: string | null
      rows: PlaceSearchJobRow[]
      /** Búsquedas de Google hechas en este trabajo. */
      searches: number
      /** Costo real: búsquedas más lo que informó cada extracción. */
      costUsd: number
      /** El trabajo se cortó (errores seguidos de Apify o Exa). */
      stopped: string | null
      /** Nombre y dirección de los candidatos, en memoria del servidor. */
      candidateDetails: Record<string, CandidateDetail>
    }

/** Costo estimado por lugar: búsqueda de Google y extracción promedio de los reportes recientes. */
export type PlaceSearchEstimate = {
  searchUsd: number
  extractionUsd: number
  /** De cuántos lugares extraídos sale el promedio; 0 = no había reportes y es el valor por defecto. */
  basedOnPlaces: number
  basedOnReports: number
}
