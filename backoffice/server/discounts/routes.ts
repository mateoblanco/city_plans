import type { Context, Hono, Next } from 'hono'
import { z } from 'zod'
import type { ApiErrorResponse } from '../../src/types/places.ts'
import type { DiscountsResponse } from '../../src/types/discounts.ts'
import { matchPlace } from './match.ts'
import type { DiscountsService } from './run.ts'

const apiError = (code: ApiErrorResponse['error']['code'], message: string): ApiErrorResponse => ({ error: { code, message } })
const NOT_CONFIGURED = 'Los descuentos necesitan la base: falta configurar DATABASE_URL en .env.local.'
const NOT_FOUND = 'No existe ese lugar del proveedor.'
const MAX_LINKS = 200

// El proveedor y una o más partes de la fuente: "bbva:la_vuelta", "santander:nora-rey",
// "itau:montevideo:dos-orientales" (ciudad y nombre).
const discountPlaceId = z.string().regex(/^[a-z0-9_-]{1,40}(?::[a-z0-9._%-]{1,200}){1,4}$/i)
// Un id de nuestros lugares con forma de uuid (la existencia la verifica el store). guid y no uuid:
// Postgres acepta cualquier uuid, no sólo los de versión/variante RFC.
const linksSchema = z.object({
  links: z.array(z.object({ placeId: z.guid(), wholeBrand: z.boolean().optional() })).max(MAX_LINKS),
})

/** Qué falló en el cuerpo de PUT links, en palabras del diálogo. */
function linksError(error: z.ZodError, body: unknown): string {
  const links = (body as { links?: unknown } | null)?.links
  if (!Array.isArray(links)) return 'Vínculos inválidos: se espera { links: [{ placeId, wholeBrand? }] }.'
  if (links.length > MAX_LINKS) return `Vínculos inválidos: son ${links.length} lugares y el máximo es ${MAX_LINKS}.`
  const issue = error.issues.find((item) => item.path[0] === 'links' && typeof item.path[1] === 'number')
  if (issue) {
    const index = issue.path[1] as number
    const field = issue.path[2]
    const value = (links[index] as Record<string, unknown> | null)?.[String(field)]
    if (field === 'placeId') return `Vínculos inválidos: el lugar ${index + 1} de ${links.length} no es un id de lugar nuestro (uuid): «${String(value)}».`
    if (field === 'wholeBrand') return `Vínculos inválidos: «toda la marca» del lugar ${index + 1} debe ser sí o no.`
    return `Vínculos inválidos: el lugar ${index + 1} de ${links.length} debe ser { placeId, wholeBrand? }.`
  }
  return `Vínculos inválidos: ${error.issues[0]?.message ?? 'formato desconocido'}.`
}
const ignoredSchema = z.object({ ignored: z.boolean() })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** /api/discounts: corrida en el servidor, lo guardado y las correcciones del cruce. */
export function registerDiscountRoutes(app: Hono, discounts: DiscountsService | undefined) {
  const configured = async (context: Context, next: Next) => {
    if (!discounts) return context.json(apiError('CONFIGURATION_ERROR', NOT_CONFIGURED), 503)
    await next()
  }
  app.use('/api/discounts', configured)
  app.use('/api/discounts/*', configured)

  app.get('/api/discounts', async (context) => {
    try {
      const [run, places] = await Promise.all([discounts!.store.latestRun(), discounts!.store.list()])
      return context.json({ run, places } satisfies DiscountsResponse)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudieron leer los descuentos: ${message(error)}`), 500)
    }
  })

  // La corrida es larga y corre en el servidor; la pantalla consulta el progreso.
  app.post('/api/discounts/runs', (context) => {
    const runId = discounts!.runner.start()
    if (!runId) return context.json(apiError('DISCOUNT_RUN_IN_PROGRESS', 'Ya hay una actualización de descuentos en curso.'), 409)
    return context.json({ runId }, 202)
  })

  app.get('/api/discounts/runs/current', (context) => context.json(discounts!.runner.status()))

  /** Devuelve el lugar actualizado, para que la fila se actualice sin recargar todo. */
  async function respondWith(context: Context, id: string) {
    const place = await discounts!.store.get(id)
    return place ? context.json({ place }) : context.json(apiError('NOT_FOUND_ERROR', NOT_FOUND), 404)
  }

  // Hono ya decodifica el parámetro: decodificarlo de nuevo rompe los slugs con "%" (o tira URIError).
  function parseId(raw: string) {
    const parsed = discountPlaceId.safeParse(raw)
    return parsed.success ? parsed.data : null
  }
  const invalidId = (context: Context) =>
    context.json(apiError('VALIDATION_ERROR', `El id del lugar del proveedor no es válido: «${context.req.param('id')}».`), 400)

  app.post('/api/discounts/places/:id/confirm', async (context) => {
    const id = parseId(context.req.param('id'))
    if (!id) return invalidId(context)
    try {
      const result = await discounts!.store.confirm(id)
      if (result === 'not_found') return context.json(apiError('NOT_FOUND_ERROR', NOT_FOUND), 404)
      if (result === 'no_links') return context.json(apiError('VALIDATION_ERROR', 'No tiene lugares vinculados para confirmar: elegí uno.'), 409)
      return respondWith(context, id)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo confirmar el cruce: ${message(error)}`), 500)
    }
  })

  app.put('/api/discounts/places/:id/links', async (context) => {
    const id = parseId(context.req.param('id'))
    if (!id) return invalidId(context)
    const raw: unknown = await context.req.json().catch(() => null)
    const body = linksSchema.safeParse(raw)
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', linksError(body.error, raw)), 400)
    const unique = [...new Map(body.data.links.map((link) => [link.placeId, { placeId: link.placeId, wholeBrand: link.wholeBrand ?? false }])).values()]
    try {
      const result = await discounts!.store.setLinks(id, unique)
      if (result === 'not_found') return context.json(apiError('NOT_FOUND_ERROR', NOT_FOUND), 404)
      if (result === 'unknown_places') return context.json(apiError('VALIDATION_ERROR', 'Alguno de los lugares elegidos ya no existe en nuestra base: recargá la pantalla y volvé a elegir.'), 400)
      return respondWith(context, id)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudieron guardar los vínculos: ${message(error)}`), 500)
    }
  })

  app.patch('/api/discounts/places/:id/ignored', async (context) => {
    const id = parseId(context.req.param('id'))
    if (!id) return invalidId(context)
    const body = ignoredSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', 'Se espera { ignored: boolean }.'), 400)
    try {
      if (!(await discounts!.store.setIgnored(id, body.data.ignored))) return context.json(apiError('NOT_FOUND_ERROR', NOT_FOUND), 404)
      return respondWith(context, id)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo guardar: ${message(error)}`), 500)
    }
  })

  // Vuelve a automático y cruza en el momento con nuestros lugares de hoy.
  app.post('/api/discounts/places/:id/auto', async (context) => {
    const id = parseId(context.req.param('id'))
    if (!id) return invalidId(context)
    try {
      const place = await discounts!.store.get(id)
      if (!place) return context.json(apiError('NOT_FOUND_ERROR', NOT_FOUND), 404)
      const match = matchPlace({ ...place, benefits: place.benefits }, await discounts!.candidates())
      await discounts!.store.setAutoMatch(id, match, new Date())
      return respondWith(context, id)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo volver a cruzar: ${message(error)}`), 500)
    }
  })
}
