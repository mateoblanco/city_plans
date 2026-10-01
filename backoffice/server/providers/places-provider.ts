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
