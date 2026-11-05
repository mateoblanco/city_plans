import 'server-only'

// Place Details (New). rating, regularOpeningHours y los de contacto (websiteUri, internationalPhoneNumber) son del SKU
// Enterprise (≈ USD 0,02); shortFormattedAddress entra en él. El teléfono sólo se usa para el WhatsApp del celular.
export const DETAILS_FIELD_MASK = 'rating,regularOpeningHours,shortFormattedAddress,websiteUri,internationalPhoneNumber'
// Sólo la dirección de una sucursal: SKU Place Details Essentials (≈ USD 0,005).
export const BRANCH_FIELD_MASK = 'shortFormattedAddress'

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
  fieldMask = DETAILS_FIELD_MASK,
): Promise<PlaceDetailsResult> {
  const key = apiKey?.trim()
  if (!key) return { ok: false, error: 'Falta configurar GOOGLE_PLACES_API_KEY.' }
  if (!placeId) return { ok: false, error: 'El lugar no tiene google_place_id.' }

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`)
  url.searchParams.set('languageCode', 'es')

  let response: Response
  try {
    response = await fetchFn(url, {
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
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

/** Un día de la semana con sus franjas en 24 h ("12:00 – 15:00"); vacío = cerrado. day: 0 = domingo. */
export type DayHours = { day: number; ranges: string[]; allDay: boolean }

/** Lo que muestra la ficha de la respuesta de Google. Cada campo es null si no vino o no tiene la forma esperada. */
export type PlaceGoogleInfo = {
  openNow: boolean | null
  rating: number | null
  address: string | null
  week: DayHours[] | null
  /** Web del lugar; null si no hay, si es Instagram (ya va aparte) o si es un link de WhatsApp (va en whatsappHref). */
  website: string | null
  /** Link de WhatsApp: la web si es de WhatsApp o, si no, el celular uruguayo (+598 9…) por wa.me. */
  whatsappHref: string | null
}

type ValidPoint = { day: number; hour: number; minute?: number }
type ValidPeriod = { open: ValidPoint; close?: ValidPoint }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max

const validPoint = (point: unknown): point is ValidPoint =>
  isRecord(point) && isInt(point.day, 0, 6) && isInt(point.hour, 0, 24) && (point.minute === undefined || isInt(point.minute, 0, 59))

const validPeriod = (period: unknown): period is ValidPeriod =>
  isRecord(period) && validPoint(period.open) && (period.close === undefined || validPoint(period.close))

const clock = (point: ValidPoint) => `${String(point.hour % 24).padStart(2, '0')}:${String(point.minute ?? 0).padStart(2, '0')}`

/** Lunes primero, como se lee la semana acá. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/**
 * Los 7 días desde regularOpeningHours.periods (día 0 = domingo, igual que Google). Una franja que cruza la medianoche
 * queda en el día que abre ("20:00 – 00:00"). Un único período sin close es abierto las 24 horas. null sin periods válidos.
 */
export function weekHours(periods: unknown): DayHours[] | null {
  if (!Array.isArray(periods)) return null
  const valid = periods.filter(validPeriod)
  if (valid.length === 0) return null
  if (valid.length === 1 && !valid[0].close) return WEEK_ORDER.map((day) => ({ day, ranges: [], allDay: true }))
  return WEEK_ORDER.map((day) => ({
    day,
    allDay: false,
    ranges: valid
      .filter((period) => period.open.day === day)
      .sort((a, b) => clock(a.open).localeCompare(clock(b.open)))
      .map((period) => (period.close ? `${clock(period.open)} – ${clock(period.close)}` : `Desde ${clock(period.open)}`)),
  }))
}

/** "Sarmiento 1345, Montevideo" → "Sarmiento 1345": la ficha dice la ciudad y el barrio en la línea siguiente. */
export function streetAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const street = value.split(',')[0]?.trim()
  return street || null
}

const httpUrl = (value: unknown): URL | null => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const hostIs = (url: URL, domains: string[]) => {
  const host = url.hostname.toLowerCase()
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

const WHATSAPP_HOSTS = ['wa.me', 'whatsapp.com']

/** La web de Google, salvo Instagram (ya se muestra aparte) y WhatsApp (va como WhatsApp). null si no es http(s). */
export function contactWebsite(value: unknown): string | null {
  const url = httpUrl(value)
  if (!url || hostIs(url, ['instagram.com', ...WHATSAPP_HOSTS])) return null
  return url.toString()
}

/** "+598 99 123 456" → "+59899123456"; null si no son sólo dígitos con un + adelante. */
function phoneDigits(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const compact = value.replace(/[\s\-().]/g, '')
  return /^\+\d{6,15}$/.test(compact) ? compact : null
}

/**
 * Google no tiene WhatsApp: si la web es de WhatsApp se usa esa; si no, un celular uruguayo (+598 9…) por wa.me, ya
 * que en Uruguay casi todos tienen WhatsApp. null en cualquier otro caso.
 */
export function whatsappHref(website: unknown, internationalPhone: unknown): string | null {
  const url = httpUrl(website)
  if (url && hostIs(url, WHATSAPP_HOSTS)) return url.toString()
  const digits = phoneDigits(internationalPhone)
  return digits && /^\+5989\d{7}$/.test(digits) ? `https://wa.me/${digits.slice(1)}` : null
}

/** Lee la respuesta de Place Details sin confiar en su forma: lo que no es válido queda en null. */
export function parseDetails(data: unknown): PlaceGoogleInfo {
  const body = isRecord(data) ? data : {}
  const hours = isRecord(body.regularOpeningHours) ? body.regularOpeningHours : null
  const rating = typeof body.rating === 'number' && Number.isFinite(body.rating) && body.rating > 0 ? body.rating : null
  return {
    openNow: typeof hours?.openNow === 'boolean' ? hours.openNow : null,
    rating,
    address: streetAddress(body.shortFormattedAddress),
    week: hours ? weekHours(hours.periods) : null,
    website: contactWebsite(body.websiteUri),
    whatsappHref: whatsappHref(body.websiteUri, body.internationalPhoneNumber),
  }
}
