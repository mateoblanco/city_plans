import { getFoodPlaceTypeLabel, seedCategoryForFoodPlaceType } from '../../src/data/food-place-types.ts'
import type {
  GooglePlaceDetailsResponse,
  GoogleRating,
  JsonValue,
} from '../../src/types/places.ts'
import type {
  FoundPlace,
  PlaceFinder,
  PlaceSearchCriteria,
  PlaceSearchPage,
  PlacesProvider,
} from './places-provider.ts'
import { PlacesProviderError } from './places-provider.ts'

const GOOGLE_TEXT_SEARCH_URL =
  'https://places.googleapis.com/v1/places:searchText'

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'nextPageToken',
].join(',')

// findPlace: Text Search Pro (USD 32 cada 1.000). Sin rating ni userRatingCount, que lo pasarían a Enterprise.
const FIND_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
].join(',')
/** Costo de una llamada a findPlace (Text Search Pro). */
export const FIND_PLACE_USD = 0.032
const MONTEVIDEO_BIAS = { center: { latitude: -34.9011, longitude: -56.1645 }, radius: 30000 }
const FIND_NEAR_METERS = 500

type GoogleLocalizedText = {
  text?: string
}

type GooglePlace = {
  id?: string
  displayName?: GoogleLocalizedText
  primaryTypeDisplayName?: GoogleLocalizedText
  googleMapsUri?: string
}

type GooglePlaceDetails = {
  displayName?: GoogleLocalizedText
  primaryTypeDisplayName?: GoogleLocalizedText
  formattedAddress?: string
  websiteUri?: string
  internationalPhoneNumber?: string
  nationalPhoneNumber?: string
  location?: {
    latitude?: number
    longitude?: number
  }
}

type GoogleSearchResponse = {
  places?: GooglePlace[]
  nextPageToken?: string
}

type GoogleErrorResponse = {
  error?: {
    status?: string
  }
}

export class GooglePlacesProvider implements PlacesProvider, PlaceFinder {
  private readonly apiKey: string
  private readonly fetcher: typeof fetch
  private readonly detailsCache = new Map<string, Promise<GooglePlaceDetailsResponse>>()

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey
    this.fetcher = fetcher
  }

  async search(criteria: PlaceSearchCriteria): Promise<PlaceSearchPage> {
    const typeLabel = criteria.mode === 'filters'
      ? getFoodPlaceTypeLabel(criteria.placeType)
      : 'Lugar'
    const body: Record<string, unknown> = {
      textQuery:
        criteria.mode === 'filters'
          ? `${typeLabel} en ${criteria.barrio}, Montevideo, Uruguay`
          : `${criteria.query}, Montevideo, Uruguay`,
      languageCode: 'es',
      regionCode: 'UY',
      rankPreference: 'RELEVANCE',
      pageSize: 20,
    }

    if (criteria.mode === 'filters') {
      body.includedType = criteria.placeType
      body.strictTypeFiltering = true
    } else {
      body.locationBias = { circle: MONTEVIDEO_BIAS }
    }

    if (criteria.pageToken) {
      body.pageToken = criteria.pageToken
    }

    let response: Response
    try {
      response = await this.fetcher(GOOGLE_TEXT_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new PlacesProviderError(
        'upstream',
        'No se pudo conectar con Google Places.',
        { cause: error },
      )
    }

    if (!response.ok) await throwGoogleError(response)

    const payload = (await response.json()) as GoogleSearchResponse
    const seedCategory = criteria.mode === 'filters'
      ? seedCategoryForFoodPlaceType(criteria.placeType)
      : criteria.seedCategory
    const items = (payload.places ?? []).flatMap((place) => {
      const placeId = place.id
      const name = place.displayName?.text
      if (!placeId || !name) return []

      return [
        {
          placeId,
          name,
          type: place.primaryTypeDisplayName?.text ?? typeLabel,
          googleMapsUri:
            place.googleMapsUri ??
            `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`,
          seedCategories: [seedCategory],
        },
      ]
    })

    return {
      items,
      nextPageToken: payload.nextPageToken || null,
    }
  }

  /**
   * Text Search de un lugar puntual ("nombre, dirección, Montevideo"), hasta 5 resultados, sesgado a 500 m de `near` si
   * hay coordenadas (si no, a Montevideo). Sin paginar. Sólo los que traen id, nombre y coordenadas.
   */
  async findPlace({ query, near }: { query: string; near?: { lat: number; lng: number } | null }): Promise<FoundPlace[]> {
    const body = {
      textQuery: query,
      languageCode: 'es',
      regionCode: 'UY',
      pageSize: 5,
      locationBias: {
        circle: near ? { center: { latitude: near.lat, longitude: near.lng }, radius: FIND_NEAR_METERS } : MONTEVIDEO_BIAS,
      },
    }
    let response: Response
    try {
      response = await this.fetcher(GOOGLE_TEXT_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': FIND_FIELD_MASK },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw new PlacesProviderError('upstream', 'No se pudo conectar con Google Places.', { cause: error })
    }
    if (!response.ok) await throwGoogleError(response)
    const payload = (await response.json()) as {
      places?: { id?: string; displayName?: GoogleLocalizedText; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; primaryType?: string }[]
    }
    return (payload.places ?? []).flatMap((place) => {
      const name = place.displayName?.text?.trim()
      const lat = place.location?.latitude
      const lng = place.location?.longitude
      if (!place.id || !name || !Number.isFinite(lat) || !Number.isFinite(lng)) return []
      return [{ placeId: place.id, name, address: place.formattedAddress?.trim() ?? '', lat: lat as number, lng: lng as number, primaryType: place.primaryType ?? null }]
    })
  }

  async getDetails(placeId: string): Promise<GooglePlaceDetailsResponse> {
    const cached = this.detailsCache.get(placeId)
    if (cached) return cached

    const request = this.fetchDetails(placeId).catch((error) => {
      this.detailsCache.delete(placeId)
      throw error
    })
    this.detailsCache.set(placeId, request)
    if (this.detailsCache.size > 100) {
      this.detailsCache.delete(this.detailsCache.keys().next().value as string)
    }
    return request
  }

  /**
   * Sólo el tipo de lugar en español (primaryTypeDisplayName), para armar consultas sin pedir
   * los detalles completos. null si Google no tiene tipo.
   */
  async getPlaceType(placeId: string): Promise<string | null> {
    let response: Response
    try {
      const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
      url.searchParams.set('languageCode', 'es')
      url.searchParams.set('regionCode', 'UY')
      response = await this.fetcher(url, {
        headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'primaryTypeDisplayName' },
      })
    } catch (error) {
      throw new PlacesProviderError('upstream', 'No se pudo conectar con Google Places.', { cause: error })
    }
    if (!response.ok) await throwGoogleError(response)
    const payload = (await response.json()) as Pick<GooglePlaceDetails, 'primaryTypeDisplayName'>
    return payload.primaryTypeDisplayName?.text?.trim() || null
  }

  /**
   * Sólo rating y userRatingCount (Place Details Enterprise), para mostrarlos en Lugares. No se guardan. null si Google
   * no tiene el dato.
   */
  async getRating(placeId: string): Promise<GoogleRating> {
    let response: Response
    try {
      const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
      response = await this.fetcher(url, {
        headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'rating,userRatingCount' },
      })
    } catch (error) {
      throw new PlacesProviderError('upstream', 'No se pudo conectar con Google Places.', { cause: error })
    }
    if (!response.ok) await throwGoogleError(response)
    const payload = (await response.json()) as { rating?: number; userRatingCount?: number }
    return { rating: payload.rating ?? null, userRatingCount: payload.userRatingCount ?? null }
  }

  /**
   * Sólo businessStatus (Place Details Pro), para places:check-status. No se guarda. 'NOT_FOUND' si Google ya no tiene
   * el lugar (404); null si no trae el dato.
   */
  async getBusinessStatus(placeId: string): Promise<string | null> {
    let response: Response
    try {
      const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
      response = await this.fetcher(url, {
        headers: { 'X-Goog-Api-Key': this.apiKey, 'X-Goog-FieldMask': 'businessStatus' },
      })
    } catch (error) {
      throw new PlacesProviderError('upstream', 'No se pudo conectar con Google Places.', { cause: error })
    }
    if (response.status === 404) return 'NOT_FOUND'
    if (!response.ok) await throwGoogleError(response)
    const payload = (await response.json()) as { businessStatus?: string }
    return payload.businessStatus || null
  }

  private async fetchDetails(placeId: string): Promise<GooglePlaceDetailsResponse> {
    let response: Response
    try {
      const url = new URL(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      )
      url.searchParams.set('languageCode', 'es')
      url.searchParams.set('regionCode', 'UY')
      response = await this.fetcher(url, {
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': '*',
        },
      })
    } catch (error) {
      throw new PlacesProviderError(
        'upstream',
        'No se pudo conectar con Google Places.',
        { cause: error },
      )
    }

    if (!response.ok) await throwGoogleError(response)

    const payload = (await response.json()) as GooglePlaceDetails
    const name = payload.displayName?.text?.trim()
    const address = payload.formattedAddress?.trim()
    const latitude = payload.location?.latitude
    const longitude = payload.location?.longitude

    if (
      !name ||
      !address ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      throw new PlacesProviderError(
        'upstream',
        'Google Places no devolvió nombre, dirección y coordenadas suficientes para comparar fuentes.',
      )
    }

    return {
      source: 'google',
      exactMatch: true,
      anchor: {
        name,
        address,
        latitude: latitude as number,
        longitude: longitude as number,
      },
      websiteUri: payload.websiteUri?.trim() || null,
      phoneNumber: payload.internationalPhoneNumber?.trim() || payload.nationalPhoneNumber?.trim() || null,
      placeType: payload.primaryTypeDisplayName?.text?.trim() || null,
      data: payload as JsonValue,
      attribution: 'Google Maps',
    }
  }
}

async function throwGoogleError(response: Response): Promise<never> {
  const payload = (await response.json().catch(() => ({}))) as GoogleErrorResponse
  const status = payload.error?.status

  if (status === 'PERMISSION_DENIED' || response.status === 401 || response.status === 403) {
    throw new PlacesProviderError(
      'authorization',
      'Google Places rechazó las credenciales configuradas.',
    )
  }

  if (status === 'RESOURCE_EXHAUSTED' || response.status === 429) {
    throw new PlacesProviderError(
      'quota',
      'Se alcanzó el límite de consultas de Google Places.',
    )
  }

  throw new PlacesProviderError(
    'upstream',
    'Google Places no pudo completar la solicitud.',
  )
}
