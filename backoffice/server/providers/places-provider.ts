import type { FoodPlaceType } from '../../src/data/food-place-types.ts'
import type { CategoryId } from '../../src/data/tags.ts'
import type { MontevideoNeighborhood } from '../../src/data/neighborhoods.ts'
import type { PlaceSummary } from '../../src/types/places.ts'

export type PlaceSearchCriteria =
  | {
      mode: 'filters'
      barrio: MontevideoNeighborhood
      placeType: FoodPlaceType
      pageToken?: string
    }
  | {
      mode: 'text'
      query: string
      seedCategory: CategoryId
      pageToken?: string
    }

export type PlaceSearchPage = {
  items: PlaceSummary[]
  nextPageToken: string | null
}

export interface PlacesProvider {
  search(criteria: PlaceSearchCriteria): Promise<PlaceSearchPage>
}

export type ProviderErrorKind =
  | 'validation'
  | 'configuration'
  | 'authorization'
  | 'quota'
  | 'timeout'
  | 'upstream'

export class PlacesProviderError extends Error {
  readonly kind: ProviderErrorKind

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'PlacesProviderError'
    this.kind = kind
  }
}

/**
 * Apify no pudo traer Instagram (agotados los reintentos, sin crédito o con el token rechazado). El lugar no se
 * procesa: sin esto se guardaría sin Instagram ni logo. HTTP 502 con código INSTAGRAM_PROVIDER_ERROR.
 */
export class InstagramProviderFailure extends PlacesProviderError {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : ''
    super('upstream', `Error de Apify: no se pudo consultar Instagram.${detail}`, { cause })
    this.name = 'InstagramProviderFailure'
  }
}

/**
 * Exa no respondió (agotados los reintentos, respuesta inválida, sin crédito o con la clave rechazada). El lugar no se
 * procesa: sin esto se guardaría sin las fuentes de Exa. HTTP 502 con código EXA_PROVIDER_ERROR.
 */
export class ExaProviderFailure extends PlacesProviderError {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : ''
    super('upstream', `Error de Exa: no se pudo consultar Exa.${detail}`, { cause })
    this.name = 'ExaProviderFailure'
  }
}
