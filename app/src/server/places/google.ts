import 'server-only'

// Place Details (New). rating, userRatingCount, regularOpeningHours, websiteUri y priceLevel son del SKU Enterprise.
export const DETAILS_FIELD_MASK = 'rating,userRatingCount,regularOpeningHours,websiteUri,priceLevel,formattedAddress'

export type PlaceDetailsResult = { ok: true; data: unknown } | { ok: false; error: string }

type ErrorBody = { error?: { message?: string; status?: string } }

/**
 * Pide los detalles en cada request: por los términos de Google no se guardan ni se cachean. Nunca tira: cualquier
 * falla vuelve como `{ ok: false }` para que la página se muestre igual.
 */
export async function fetchPlaceDetails(
  placeId: string | null,
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
  fetchFn: typeof fetch = fetch,
): Promise<PlaceDetailsResult> {
  const key = apiKey?.trim()
  if (!key) return { ok: false, error: 'Falta configurar GOOGLE_PLACES_API_KEY.' }
  if (!placeId) return { ok: false, error: 'El lugar no tiene google_place_id.' }

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
  url.searchParams.set('languageCode', 'es')

  let response: Response
  try {
    response = await fetchFn(url, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': DETAILS_FIELD_MASK },
      cache: 'no-store',
    })
  } catch (error) {
    return { ok: false, error: `No se pudo conectar con Google (${error instanceof Error ? error.message : String(error)}).` }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, error: `Google respondió ${response.status} con un cuerpo que no es JSON.` }
  }

  if (!response.ok) {
    const detail = (body as ErrorBody | null)?.error
    return { ok: false, error: `Google respondió ${response.status}${detail?.message ? `: ${detail.message}` : '.'}` }
  }
  return { ok: true, data: body }
}
