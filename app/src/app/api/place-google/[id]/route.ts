import type { NextRequest } from 'next/server'
import { isBot } from '@/server/events/bots'
import { fetchPlaceDetails, parseDetails } from '@/server/places/google'
import { getPublishedGooglePlaceId } from '@/server/places/place'

/**
 * Lo de Google de una ficha (Place Details del lugar: puntaje, reseñas, horarios, abierto ahora, dirección, web y
 * WhatsApp), pedido por el navegador una vez por vista, después de hidratar (PlaceGoogleProvider). El render del
 * servidor de la ficha nunca llama a Google. Sin caché (términos de Google) y fuera de los buscadores (robots.txt y
 * X-Robots-Tag). Con un bot, desde otro sitio, con un id que no es de un lugar publicado con google_place_id, o si
 * Google falla (también por la cuota diaria, 429): 204 vacío, sin error; la ficha se muestra sin lo de Google.
 */
const HEADERS = { 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow' }

const empty = () => new Response(null, { status: 204, headers: HEADERS })

export async function GET(request: NextRequest, ctx: RouteContext<'/api/place-google/[id]'>) {
  if (isBot(request.headers.get('user-agent'))) return empty()
  // Sólo desde la propia app (los navegadores mandan Sec-Fetch-Site; sin el header, se acepta, como /api/events).
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return empty()

  const { id } = await ctx.params
  let googlePlaceId: string | null
  try {
    googlePlaceId = await getPublishedGooglePlaceId(id)
  } catch (error) {
    console.warn('/api/place-google: base', error instanceof Error ? error.message : 'desconocido')
    return empty()
  }
  if (!googlePlaceId) return empty()

  const details = await fetchPlaceDetails(googlePlaceId)
  if (!details.ok) {
    console.warn('/api/place-google:', details.error)
    return empty()
  }
  return Response.json(parseDetails(details.data), { headers: HEADERS })
}
