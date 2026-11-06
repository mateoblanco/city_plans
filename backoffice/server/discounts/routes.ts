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

// "bbva:la_vuelta": proveedor y slug de la fuente.
const discountPlaceId = z.string().regex(/^[a-z0-9_-]{1,40}:[a-z0-9._%-]{1,200}$/i)
const linksSchema = z.object({
  links: z.array(z.object({ placeId: z.uuid(), wholeBrand: z.boolean().optional() })).max(MAX_LINKS),
})
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

  function parseId(raw: string) {
    const parsed = discountPlaceId.safeParse(decodeURIComponent(raw))
    return parsed.success ? parsed.data : null
  }

  app.post('/api/discounts/places/:id/confirm', async (context) => {
    const id = parseId(context.req.param('id'))
    if (!id) return context.json(apiError('VALIDATION_ERROR', 'Id inválido.'), 400)
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
    const body = linksSchema.safeParse(await context.req.json().catch(() => null))
    if (!id || !body.success) return context.json(apiError('VALIDATION_ERROR', `Vínculos inválidos: una lista de hasta ${MAX_LINKS} lugares (uuid).`), 400)
    const unique = [...new Map(body.data.links.map((link) => [link.placeId, { placeId: link.placeId, wholeBrand: link.wholeBrand ?? false }])).values()]
    try {
      const result = await discounts!.store.setLinks(id, unique)
      if (result === 'not_found') return context.json(apiError('NOT_FOUND_ERROR', NOT_FOUND), 404)
      if (result === 'unknown_places') return context.json(apiError('VALIDATION_ERROR', 'Alguno de los lugares no existe en la base.'), 400)
      return respondWith(context, id)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudieron guardar los vínculos: ${message(error)}`), 500)
    }
  })

  app.patch('/api/discounts/places/:id/ignored', async (context) => {
    const id = parseId(context.req.param('id'))
    const body = ignoredSchema.safeParse(await context.req.json().catch(() => null))
    if (!id || !body.success) return context.json(apiError('VALIDATION_ERROR', 'Se espera { ignored: boolean }.'), 400)
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
    if (!id) return context.json(apiError('VALIDATION_ERROR', 'Id inválido.'), 400)
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
