import type { Context, Hono, Next } from 'hono'
import { z } from 'zod'
import type { ApiErrorResponse } from '../../src/types/places.ts'
import type { DiscountsListResponse, OurPlaceOption } from '../../src/types/discounts.ts'
import { matchPlace, metersBetween } from './match.ts'
import { missingRows } from './missing.ts'
import { OUR_PLACES_LIMIT, type OurPlaceRow } from './our-places.ts'
import { MAX_SEARCH_ROWS } from './place-search-runner.ts'
import { suggestOurPlaces, type Suggestion } from './suggestions.ts'
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
const MAX_BULK = 200
const coordinates = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
const suggestionsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  coordinates: coordinates.nullable(),
  instagram: z.string().trim().max(100).nullable(),
  candidateIds: z.array(z.guid()).max(50).optional(),
})
const ourPlacesQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
})
// Una fila de "No están en la base": las claves de sus locales ("bbva:la-pasiva#0|santander:la-pasiva#1").
const rowKey = z.string().min(3).max(4000)
const searchSchema = z.object({ rows: z.array(rowKey).min(1).max(MAX_SEARCH_ROWS) })
const pickSchema = z.object({ rowKey, placeId: z.string().regex(/^[A-Za-z0-9_-]{2,256}$/).nullable() })
const rowSchema = z.object({ rowKey })
const SEARCH_NOT_CONFIGURED = 'Buscar en Google necesita GOOGLE_PLACES_API_KEY y AI_GATEWAY_API_KEY en .env.local.'

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
      const [run, places, searches] = await Promise.all([discounts!.store.latestRun(), discounts!.store.list(), discounts!.store.placeSearches()])
      return context.json({ run, places, searches, missing: missingRows(places) } satisfies DiscountsListResponse)
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

  // Descartar (o volver a mostrar) varios a la vez: decisión manual, la regla de rubros no los toca más.
  const bulkIgnoredSchema = z.object({ ids: z.array(discountPlaceId).min(1).max(MAX_BULK), ignored: z.boolean() })
  app.post('/api/discounts/places/ignored', async (context) => {
    const body = bulkIgnoredSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', `Se espera { ids: [...], ignored: boolean } con entre 1 y ${MAX_BULK} lugares del proveedor.`), 400)
    try {
      const updated = await discounts!.store.setIgnoredMany([...new Set(body.data.ids)], body.data.ignored)
      return context.json({ places: await discounts!.store.getMany(updated) })
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo guardar: ${message(error)}`), 500)
    }
  })

  const option = (row: OurPlaceRow, near: { lat: number; lng: number } | null, suggestion?: Suggestion): OurPlaceOption => {
    const { location, ...rest } = row
    return {
      ...rest,
      meters: suggestion?.meters ?? (near && location ? Math.round(metersBetween(near, location)) : null),
      score: suggestion?.score ?? null,
      reason: suggestion?.reason ?? null,
    }
  }

  // Panel «Resolver»: buscar en todos nuestros lugares (nombre, Instagram o marca), con la distancia al local.
  app.get('/api/discounts/our-places', async (context) => {
    if (!discounts!.ourPlaces) return context.json(apiError('CONFIGURATION_ERROR', NOT_CONFIGURED), 503)
    const query = ourPlacesQuerySchema.safeParse(context.req.query())
    if (!query.success) return context.json(apiError('VALIDATION_ERROR', 'Se espera ?q= (1 a 200 caracteres) y, opcional, lat y lng.'), 400)
    const near = query.data.lat !== undefined && query.data.lng !== undefined ? { lat: query.data.lat, lng: query.data.lng } : null
    try {
      const rows = await discounts!.ourPlaces.search(query.data.q, OUR_PLACES_LIMIT)
      return context.json({ places: rows.map((row) => option(row, near)) })
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo buscar en nuestros lugares: ${message(error)}`), 500)
    }
  })

  // Sugerencias sin escribir: cerca (≤ 300 m, con cualquier nombre), mismo Instagram y nombres parecidos.
  app.post('/api/discounts/our-places/suggestions', async (context) => {
    if (!discounts!.ourPlaces) return context.json(apiError('CONFIGURATION_ERROR', NOT_CONFIGURED), 503)
    const body = suggestionsSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', 'Se espera { name, coordinates: { lat, lng } | null, instagram | null }.'), 400)
    try {
      const suggestions = suggestOurPlaces(body.data, await discounts!.candidates())
      const rows = new Map((await discounts!.ourPlaces.byIds(suggestions.map((item) => item.placeId))).map((row) => [row.id, row]))
      return context.json({ places: suggestions.flatMap((item) => (rows.has(item.placeId) ? [option(rows.get(item.placeId)!, body.data.coordinates, item)] : [])) })
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudieron armar las sugerencias: ${message(error)}`), 500)
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

  // Buscar en Google los que no están en la base y mandarlos a extracción (siempre a "A revisar"). Corre en el
  // servidor; la pantalla consulta el progreso.
  app.post('/api/discounts/searches', async (context) => {
    if (!discounts!.search) return context.json(apiError('CONFIGURATION_ERROR', SEARCH_NOT_CONFIGURED), 503)
    const body = searchSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', `Se espera { rows: [...] } con entre 1 y ${MAX_SEARCH_ROWS} filas.`), 400)
    try {
      const started = await discounts!.search.start(body.data.rows)
      if ('busy' in started) return context.json(apiError('DISCOUNT_SEARCH_IN_PROGRESS', 'Ya hay una búsqueda de lugares en curso.'), 409)
      if ('unknown' in started) return context.json(apiError('VALIDATION_ERROR', `${started.unknown.length === 1 ? 'Una fila ya no está' : `${started.unknown.length} filas ya no están`} en «No están en la base»: recargá la pantalla.`), 400)
      return context.json(started, 202)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo empezar la búsqueda: ${message(error)}`), 500)
    }
  })

  app.get('/api/discounts/searches/current', (context) => context.json(discounts!.search?.status() ?? { status: 'idle' }))

  app.get('/api/discounts/searches/estimate', async (context) => {
    if (!discounts!.search || !discounts!.estimate) return context.json(apiError('CONFIGURATION_ERROR', SEARCH_NOT_CONFIGURED), 503)
    return context.json(await discounts!.estimate())
  })

  // Un dudoso: elegir un candidato (va a extracción) o ninguno (placeId null: no encontrado).
  app.post('/api/discounts/searches/pick', async (context) => {
    if (!discounts!.search) return context.json(apiError('CONFIGURATION_ERROR', SEARCH_NOT_CONFIGURED), 503)
    const body = pickSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', 'Se espera { rowKey, placeId } (placeId null = ninguno).'), 400)
    try {
      const result = await discounts!.search.pick(body.data.rowKey, body.data.placeId)
      if (result === 'not_found') return context.json(apiError('NOT_FOUND_ERROR', 'Esa fila ya no está en «No están en la base»: recargá la pantalla.'), 404)
      if (result === 'not_doubtful') return context.json(apiError('VALIDATION_ERROR', 'Esa fila no está dudosa: no hay candidatos para elegir.'), 409)
      if (result === 'not_candidate') return context.json(apiError('VALIDATION_ERROR', 'Ese lugar no es uno de los candidatos de la búsqueda.'), 400)
      if (result === 'in_progress') return context.json(apiError('DISCOUNT_SEARCH_IN_PROGRESS', 'Esa fila se está buscando o extrayendo: esperá a que termine.'), 409)
      return context.json({ ok: true, searches: await discounts!.search.ownerSearches(body.data.rowKey) })
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo guardar la elección: ${message(error)}`), 500)
    }
  })

  // Panel «Resolver»: buscar la fila en Google en el momento (nombre y dirección sólo para mostrar; se guarda place_id).
  app.post('/api/discounts/searches/google', async (context) => {
    if (!discounts!.search) return context.json(apiError('CONFIGURATION_ERROR', SEARCH_NOT_CONFIGURED), 503)
    const body = rowSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', 'Se espera { rowKey }.'), 400)
    try {
      const result = await discounts!.search.lookup(body.data.rowKey)
      if (result === 'not_found') return context.json(apiError('NOT_FOUND_ERROR', 'Esa fila ya no está en «No están en la base»: recargá la pantalla.'), 404)
      if (result === 'in_progress') return context.json(apiError('DISCOUNT_SEARCH_IN_PROGRESS', 'Esa fila se está buscando o extrayendo: esperá a que termine.'), 409)
      return context.json(result)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudo buscar en Google: ${message(error)}`), 502)
    }
  })

  // Nombre y dirección de los candidatos guardados (sólo place_id en la base): de la memoria o de Google otra vez.
  app.post('/api/discounts/searches/candidates', async (context) => {
    if (!discounts!.search) return context.json(apiError('CONFIGURATION_ERROR', SEARCH_NOT_CONFIGURED), 503)
    const body = rowSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', 'Se espera { rowKey }.'), 400)
    try {
      const result = await discounts!.search.candidateNames(body.data.rowKey)
      if (result === 'not_found') return context.json(apiError('NOT_FOUND_ERROR', 'Esa fila ya no está en «No están en la base»: recargá la pantalla.'), 404)
      return context.json(result)
    } catch (error) {
      return context.json(apiError('UNKNOWN_ERROR', `No se pudieron pedir los nombres a Google: ${message(error)}`), 502)
    }
  })
}
