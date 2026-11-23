import type { Context, Hono } from 'hono'
import { z } from 'zod'
import { GUIDE_GROUPS } from '../../src/data/guides.ts'
import { NEIGHBORHOOD_NAMES, neighborhoodDisplayName } from '../../src/data/neighborhood-names.ts'
import type { GuideGeneratedValue } from '../../src/types/guides.ts'
import { AI_CREDIT_URL, GuideAiError, guidesModel, type Generator } from './generate.ts'
import { topLabels, type AreaContext, type GuideDraftContext } from './prompts.ts'
import type { GuidesStore } from './store.ts'

/**
 * Generación de textos de guías con IA (POST /api/guides/generate) y el estado del crédito (GET /api/guides/ai-status).
 * Lo generado vuelve al editor como borrador: acá nunca se guarda ni se publica un texto. Lo único que se escribe es el
 * costo, sumado a la guía si está guardada (también el de una respuesta descartada por inválida: se pagó igual).
 */
const MISSING_DATABASE = 'Falta configurar DATABASE_URL en .env.local.'

const apiError = (code: string, message: string) => ({ error: { code, message } })

const neighborhoodId = z
  .string()
  .nullable()
  .refine((value) => value === null || Object.hasOwn(NEIGHBORHOOD_NAMES, value), 'Barrio desconocido.')

const draftSchema = z.object({
  idea: z.string().trim().max(200),
  title: z.string().trim().max(160),
  intro: z.string().trim().max(4000),
  neighborhoodId,
  group: z.enum(GUIDE_GROUPS),
  places: z.array(z.object({ placeId: z.guid(), text: z.string().max(1000) })).max(40),
})

const requestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title'), guideId: z.string().nullish(), draft: draftSchema }),
  z.object({ kind: z.literal('seo'), guideId: z.string().nullish(), draft: draftSchema }),
  z.object({ kind: z.literal('intro'), guideId: z.string().nullish(), draft: draftSchema }),
  z.object({ kind: z.literal('place'), guideId: z.string().nullish(), draft: draftSchema, placeId: z.guid() }),
  z.object({ kind: z.literal('places-empty'), guideId: z.string().nullish(), draft: draftSchema }),
  z.object({ kind: z.literal('neighborhood-intro'), neighborhoodId: z.string().refine((value) => Object.hasOwn(NEIGHBORHOOD_NAMES, value), 'Barrio desconocido.') }),
  z.object({ kind: z.literal('city-intro') }),
])

type Request = z.infer<typeof requestSchema>

const contextOf = (draft: z.infer<typeof draftSchema>): GuideDraftContext => ({
  idea: draft.idea,
  title: draft.title,
  intro: draft.intro,
  neighborhoodId: draft.neighborhoodId,
  group: draft.group,
})

/** El contexto de la intro de un barrio o de la ciudad, sólo con lo publicado en la base. */
async function areaContext(store: GuidesStore, neighborhood: string | null): Promise<AreaContext> {
  const data = await store.areaData(neighborhood)
  const neighborhoods = neighborhood
    ? undefined
    : [...new Set(data.guides.flatMap((guide) => (guide.neighborhoodId ? [neighborhoodDisplayName(guide.neighborhoodId) ?? guide.neighborhoodId] : [])))]
  return {
    neighborhoodId: neighborhood,
    guides: data.guides.map((guide) => ({ title: guide.title, group: guide.group as AreaContext['guides'][number]['group'] })),
    categories: topLabels(data.categories, 6),
    tags: topLabels(data.tags, 10),
    placeCount: data.placeCount,
    neighborhoods,
  }
}

export function registerGuideAiRoutes(
  app: Hono,
  store: GuidesStore | undefined,
  options: { generator?: Generator; balance?: () => Promise<number | null> },
) {
  app.get('/api/guides/ai-status', async (context) => {
    context.header('Cache-Control', 'no-store')
    const balanceUsd = options.balance ? await options.balance().catch(() => null) : null
    return context.json({ model: options.generator?.model ?? guidesModel(), balanceUsd, creditUrl: AI_CREDIT_URL })
  })

  app.post('/api/guides/generate', async (context) => {
    if (!store) return context.json(apiError('CONFIGURATION_ERROR', MISSING_DATABASE), 503)
    const generator = options.generator
    if (!generator) return context.json(apiError('CONFIGURATION_ERROR', 'Falta configurar AI_GATEWAY_API_KEY en .env.local.'), 503)
    const body = requestSchema.safeParse(await context.req.json().catch(() => null))
    if (!body.success) return context.json(apiError('VALIDATION_ERROR', body.error.issues[0]?.message ?? 'Datos inválidos.'), 400)
    const request = body.data
    const guideId = 'guideId' in request ? (request.guideId ?? null) : null
    let spent = 0

    /** Suma lo gastado a la guía guardada (si hay) y arma la respuesta con el total. */
    const respond = async (status: 200 | 402 | 422 | 502, payload: Record<string, unknown>) => {
      const guideCostUsd = guideId && spent > 0 ? await store.addAiCost(guideId, spent).catch(() => null) : null
      return context.json({ ...payload, costUsd: spent, guideCostUsd }, status)
    }

    try {
      const value = await generate(context, store, generator, request, (usd) => {
        spent += usd
      })
      if (value instanceof Response) return value
      return respond(200, { value })
    } catch (error) {
      if (error instanceof GuideAiError) {
        spent += error.costUsd
        if (error.code === 'AI_NO_CREDIT') return respond(402, { ...apiError(error.code, error.message), creditUrl: AI_CREDIT_URL })
        return respond(error.code === 'AI_INVALID_OUTPUT' ? 422 : 502, apiError(error.code, error.message))
      }
      console.error(JSON.stringify({ event: 'guide_generate_error', message: error instanceof Error ? error.message : String(error) }))
      return respond(502, apiError('AI_ERROR', 'No se pudo generar el texto.'))
    }
  })
}

async function generate(
  context: Context,
  store: GuidesStore,
  generator: Generator,
  request: Request,
  pay: (usd: number) => void,
): Promise<GuideGeneratedValue | Response> {
  const noPlaces = () => context.json(apiError('VALIDATION_ERROR', 'Agregá al menos un lugar a la guía antes de generar.'), 422)

  switch (request.kind) {
    case 'title':
    case 'seo':
    case 'intro': {
      const rows = await store.placesForPrompt(request.draft.places.map((place) => place.placeId))
      if (rows.length === 0) return noPlaces()
      const draft = contextOf(request.draft)
      if (request.kind === 'title') {
        const { value, costUsd } = await generator.title(draft, rows)
        pay(costUsd)
        return { kind: 'title', title: value.title.trim() }
      }
      if (request.kind === 'seo') {
        const { value, costUsd } = await generator.seo(draft, rows)
        pay(costUsd)
        return { kind: 'seo', seoTitle: value.seoTitle.trim(), seoDescription: value.seoDescription.trim() }
      }
      const { value, costUsd } = await generator.intro(draft, rows)
      pay(costUsd)
      return { kind: 'intro', intro: value.sentences.map((sentence) => sentence.trim()).join(' ') }
    }
    case 'place': {
      if (!request.draft.places.some((place) => place.placeId === request.placeId)) return context.json(apiError('VALIDATION_ERROR', 'Ese lugar no está en la guía.'), 422)
      const [row] = await store.placesForPrompt([request.placeId])
      if (!row) return context.json(apiError('VALIDATION_ERROR', 'Ese lugar ya no existe.'), 422)
      const others = request.draft.places.filter((place) => place.placeId !== request.placeId && place.text.trim()).map((place) => place.text.trim())
      const { value, costUsd } = await generator.place(contextOf(request.draft), row, others)
      pay(costUsd)
      return { kind: 'place', placeId: request.placeId, text: value.text.trim() }
    }
    case 'places-empty': {
      const empty = request.draft.places.filter((place) => !place.text.trim()).map((place) => place.placeId)
      if (empty.length === 0) return context.json(apiError('VALIDATION_ERROR', 'Todos los lugares ya tienen texto.'), 422)
      const rows = await store.placesForPrompt(empty)
      const draft = contextOf(request.draft)
      // De a uno y en orden: cada texto ve los que ya tiene la guía y los generados antes, para no repetir arranques ni frases.
      const written = request.draft.places.filter((place) => place.text.trim()).map((place) => place.text.trim())
      const results: { placeId: string; text: string | undefined; error: GuideAiError | undefined }[] = []
      for (const row of rows) {
        try {
          const { value, costUsd } = await generator.place(draft, row, written)
          pay(costUsd)
          written.push(value.text.trim())
          results.push({ placeId: row.id, text: value.text.trim(), error: undefined })
        } catch (error) {
          const failure = error instanceof GuideAiError ? error : new GuideAiError('AI_ERROR', error instanceof Error ? error.message : String(error))
          pay(failure.costUsd)
          results.push({ placeId: row.id, text: undefined, error: failure })
          // Sin crédito, no tiene sentido seguir.
          if (failure.code === 'AI_NO_CREDIT') break
        }
      }
      const texts = results.flatMap((result) => (typeof result.text === 'string' ? [{ placeId: result.placeId, text: result.text }] : []))
      const errors = results.flatMap((result) => (result.error ? [{ placeId: result.placeId, message: result.error.message, code: result.error.code }] : []))
      // Sin crédito y nada generado: el mismo 402 que una sola generación.
      if (texts.length === 0 && errors.some((error) => error.code === 'AI_NO_CREDIT')) throw new GuideAiError('AI_NO_CREDIT', 'El AI Gateway no tiene crédito: cargá crédito y volvé a intentar.')
      return { kind: 'places-empty', texts, errors: errors.map(({ placeId, message }) => ({ placeId, message })) }
    }
    case 'neighborhood-intro':
    case 'city-intro': {
      const area = await areaContext(store, request.kind === 'neighborhood-intro' ? request.neighborhoodId : null)
      if (area.placeCount === 0) return context.json(apiError('VALIDATION_ERROR', 'No hay lugares publicados para escribir esta introducción.'), 422)
      const { value, costUsd } = await generator.area(area)
      pay(costUsd)
      return { kind: 'area-intro', intro: value.paragraphs.map((paragraph) => paragraph.trim()).join('\n\n') }
    }
  }
}
