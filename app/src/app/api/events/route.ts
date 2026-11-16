import { after, type NextRequest } from 'next/server'
import { ipAddress } from '@vercel/functions'
import { z } from 'zod'
import { EVENT_ORIGINS, EVENT_TYPES, ORIGIN_ROW_PATTERN } from '@shared/events.ts'
import { trackEvents } from '@/server/events/config'
import { isBot } from '@/server/events/bots'
import { recordEvent } from '@/server/events/record'

const Body = z.object({
  placeId: z.uuid(),
  type: z.enum(EVENT_TYPES),
  origin: z.enum(EVENT_ORIGINS),
  row: z.string().regex(ORIGIN_ROW_PATTERN).nullish().transform((row) => row ?? null),
})

const noContent = () => new Response(null, { status: 204 })

/**
 * Eventos de popularidad (sendBeacon o fetch keepalive desde la ficha y las cards). Responde enseguida y guarda
 * después de la respuesta (after): nunca hace esperar al navegador, y si falla se pierde. Sin cookies. Con
 * TRACK_EVENTS apagado, con un bot o desde otro sitio, no hace nada.
 */
export async function POST(request: NextRequest) {
  if (!trackEvents()) return noContent()
  const userAgent = request.headers.get('user-agent')
  if (isBot(userAgent)) return noContent()
  // Sólo desde la propia app (los navegadores mandan Sec-Fetch-Site; sin el header, se acepta).
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') return noContent()

  let json: unknown
  try {
    json = JSON.parse(await request.text())
  } catch {
    return Response.json({ error: 'Evento inválido' }, { status: 400 })
  }
  const parsed = Body.safeParse(json)
  if (!parsed.success) return Response.json({ error: 'Evento inválido' }, { status: 400 })

  const ip = ipAddress(request) ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  const client = { ip, userAgent: userAgent ?? '' }
  after(async () => {
    try {
      await recordEvent(parsed.data, client)
    } catch (error) {
      // Sin datos del visitante: sólo el tipo y el mensaje.
      console.error('Error en /api/events', parsed.data.type, error instanceof Error ? error.message : 'desconocido')
    }
  })
  return noContent()
}
