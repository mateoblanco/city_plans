import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { z } from 'zod'
import { isFoodPlaceType } from '../src/data/food-place-types.ts'
import { CATEGORIES, ids } from '../src/data/tags.ts'
import { isMontevideoNeighborhood } from '../src/data/neighborhoods.ts'
import type {
  ApiErrorResponse,
  ExaPlaceResponse,
  GooglePlaceDetailsResponse,
  MatchSource,
  NeighborhoodSweepEvent,
  PlaceEnrichmentResponse,
  PlacesSearchResponse,
} from '../src/types/places.ts'
import type { PlaceMatchProvider } from './providers/place-match-provider.ts'
import { matchPlace } from './providers/place-match-provider.ts'
import type { PlacesProvider } from './providers/places-provider.ts'
import { PlacesProviderError } from './providers/places-provider.ts'
import type { ExaPlaceProvider } from './providers/exa-place-provider.ts'
import type { PlaceExtractor } from './providers/place-extraction-service.ts'
import type { NeighborhoodSweeper } from './providers/neighborhood-sweep.ts'
import {
  buildExtractionReport,
  extractionReportRequestSchema,
  reportSummary,
  type ExtractionReportWriter,
} from './providers/extraction-report.ts'
import { NEIGHBORHOOD_IDS } from '../src/lib/getNeighborhood.ts'

const pageTokenSchema = z.string().trim().min(1).max(2048).optional()
const requestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('filters'),
    barrio: z.string().trim().min(1),
    placeType: z.string().trim().min(1),
    pageToken: pageTokenSchema,
  }),
  z.object({
    mode: z.literal('text'),
    query: z.string().trim().min(2).max(200),
    seedCategory: z.enum(ids(CATEGORIES)),
    pageToken: pageTokenSchema,
  }),
])

const anchorSchema = z.object({
  anchor: z.object({
    name: z.string().trim().min(1).max(300),
    address: z.string().trim().max(500),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  }),
})

const exaRequestSchema = z.object({
  name: z.string().trim().min(1).max(300),
  refresh: z.boolean().optional(),
})

const sweepRequestSchema = z.object({
  mode: z.enum(['full', 'ids']).default('full'),
})

const extractRequestSchema = z.object({
  googlePlaceId: z.string().regex(/^[A-Za-z0-9_-]{2,256}$/),
  seedCategories: z.array(z.enum(ids(CATEGORIES))).min(1).max(20),
  neighborhoodId: z.string().refine((value) => NEIGHBORHOOD_IDS.includes(value)).optional(),
})

const matchSources = new Set<MatchSource>([
  'overture',
  'openstreetmap',
])

type GoogleProvider = PlacesProvider & {
  getDetails?(placeId: string): Promise<GooglePlaceDetailsResponse>
}

type AppDependencies = {
  provider?: GoogleProvider
  exaProvider?: ExaPlaceProvider
  matchProviders?: Partial<Record<MatchSource, PlaceMatchProvider>>
  instagramConfigured?: boolean
  extractor?: PlaceExtractor
  sweeper?: NeighborhoodSweeper
  reportWriter?: ExtractionReportWriter
}

function apiError(
  code: ApiErrorResponse['error']['code'],
  message: string,
): ApiErrorResponse {
  return { error: { code, message } }
}

function providerError(error: PlacesProviderError) {
  if (error.kind === 'validation') {
    return { status: 400 as const, body: apiError('VALIDATION_ERROR', error.message) }
  }
  if (error.kind === 'configuration') {
    return { status: 503 as const, body: apiError('CONFIGURATION_ERROR', error.message) }
  }
  if (error.kind === 'authorization') {
    return { status: 502 as const, body: apiError('AUTHORIZATION_ERROR', error.message) }
  }
  if (error.kind === 'quota') {
    return { status: 429 as const, body: apiError('QUOTA_ERROR', error.message) }
  }
  if (error.kind === 'timeout') {
    return { status: 504 as const, body: apiError('TIMEOUT_ERROR', error.message) }
  }
  return { status: 502 as const, body: apiError('UPSTREAM_ERROR', error.message) }
}

export function createApp({ provider, exaProvider, matchProviders = {}, instagramConfigured = false, extractor, sweeper, reportWriter }: AppDependencies = {}) {
  const app = new Hono()

  app.get('/api/health', (context) =>
    context.json({
      status: 'ok',
      sources: {
        google: Boolean(provider),
        exa: Boolean(exaProvider?.configured),
        overture: Boolean(matchProviders.overture?.configured),
        openstreetmap: Boolean(matchProviders.openstreetmap?.configured),
        instagram: instagramConfigured,
        placeExtraction: Boolean(extractor?.configured),
        neighborhoodSweep: Boolean(sweeper),
      },
    }),
  )

  app.post('/api/places/search', async (context) => {
    if (!provider) {
      return context.json(
        apiError(
          'CONFIGURATION_ERROR',
          'Falta configurar GOOGLE_PLACES_API_KEY en .env.local.',
        ),
        503,
      )
    }

    const body = await context.req.json().catch(() => null)
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(
        apiError('VALIDATION_ERROR', 'Los criterios de búsqueda no son válidos.'),
        400,
      )
    }

    try {
      let result: PlacesSearchResponse
      if (parsed.data.mode === 'filters') {
        const { barrio, placeType, pageToken } = parsed.data
        if (!isMontevideoNeighborhood(barrio) || !isFoodPlaceType(placeType)) {
          return context.json(
            apiError('VALIDATION_ERROR', 'El barrio o la categoría no están permitidos.'),
            400,
          )
        }
        result = await provider.search({
          mode: 'filters',
          barrio,
          placeType,
          pageToken,
        })
      } else {
        result = await provider.search({
          mode: 'text',
          query: parsed.data.query,
          seedCategory: parsed.data.seedCategory,
          pageToken: parsed.data.pageToken,
        })
      }
      context.header('Cache-Control', 'no-store')
      return context.json(result)
    } catch (error) {
      if (error instanceof PlacesProviderError) {
        const mapped = providerError(error)
        return context.json(mapped.body, mapped.status)
      }
      return context.json(
        apiError('UNKNOWN_ERROR', 'Ocurrió un error inesperado al buscar lugares.'),
        500,
      )
    }
  })

  app.post('/api/neighborhoods/:neighborhoodId/sweep', async (context) => {
    if (!sweeper) {
      return context.json(
        apiError('CONFIGURATION_ERROR', 'Falta configurar GOOGLE_PLACES_API_KEY en .env.local.'),
        503,
      )
    }

    const neighborhoodId = context.req.param('neighborhoodId')
    if (!NEIGHBORHOOD_IDS.includes(neighborhoodId)) {
      return context.json(apiError('VALIDATION_ERROR', 'El barrio no está permitido.'), 400)
    }

    const body = await context.req.json().catch(() => ({}))
    const parsed = sweepRequestSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return context.json(apiError('VALIDATION_ERROR', 'El modo de recorrido no es válido.'), 400)
    }
    const { mode } = parsed.data

    context.header('Content-Type', 'application/x-ndjson; charset=utf-8')
    context.header('Cache-Control', 'no-store')
    return stream(context, async (output) => {
      const controller = new AbortController()
      const requestSignal = context.req.raw.signal
      if (requestSignal.aborted) controller.abort()
      requestSignal.addEventListener('abort', () => controller.abort(), { once: true })
      output.onAbort(() => controller.abort())

      let writes = Promise.resolve()
      const send = (event: NeighborhoodSweepEvent) => {
        if (controller.signal.aborted) return
        writes = writes.then(() => output.write(`${JSON.stringify(event)}\n`)).then(() => undefined, () => undefined)
      }

      try {
        const { summary } = await sweeper.sweep(neighborhoodId, { mode, signal: controller.signal, onEvent: send })
        send({ type: 'done', summary })
      } catch (error) {
        const mapped = error instanceof PlacesProviderError
          ? providerError(error).body
          : apiError('UNKNOWN_ERROR', 'Ocurrió un error inesperado al recorrer el barrio.')
        send({ type: 'error', error: mapped.error })
      }
      await writes
    })
  })

  app.get('/api/places/:placeId/google-details', async (context) => {
    if (!provider?.getDetails) {
      return context.json(
        apiError('CONFIGURATION_ERROR', 'Falta configurar GOOGLE_PLACES_API_KEY en .env.local.'),
        503,
      )
    }

    const placeId = context.req.param('placeId')
    if (!/^[A-Za-z0-9_-]{2,256}$/.test(placeId)) {
      return context.json(apiError('VALIDATION_ERROR', 'El Google Place ID no es válido.'), 400)
    }

    try {
      context.header('Cache-Control', 'no-store')
      return context.json(await provider.getDetails(placeId))
    } catch (error) {
      if (error instanceof PlacesProviderError) {
        const mapped = providerError(error)
        return context.json(mapped.body, mapped.status)
      }
      return context.json(
        apiError('UNKNOWN_ERROR', 'No se pudo obtener el detalle de Google Places.'),
        500,
      )
    }
  })

  // Un lugar por request y sin estado: el frontend reparte el lote con p-map.
  app.post('/api/extract', async (context) => {
    if (!extractor?.configured) {
      return context.json(
        apiError('CONFIGURATION_ERROR', 'Falta configurar AI_GATEWAY_API_KEY en .env.local.'),
        503,
      )
    }

    const body = await context.req.json().catch(() => null)
    const parsed = extractRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(apiError('VALIDATION_ERROR', 'La solicitud de extracción no es válida.'), 400)
    }

    try {
      context.header('Cache-Control', 'no-store')
      const { googlePlaceId, seedCategories, neighborhoodId } = parsed.data
      const result: PlaceEnrichmentResponse = await extractor.extract(googlePlaceId, {
        seedCategories,
        ...(neighborhoodId ? { neighborhoodId } : {}),
      })
      return context.json(result)
    } catch (error) {
      if (error instanceof PlacesProviderError) {
        const mapped = providerError(error)
        return context.json(mapped.body, mapped.status)
      }
      return context.json(
        apiError('UNKNOWN_ERROR', 'No se pudo extraer la información del lugar.'),
        500,
      )
    }
  })

  // El frontend lo manda al terminar cada lote: sólo escribe el archivo y lo resume en consola.
  app.post('/api/extraction-reports', async (context) => {
    if (!reportWriter) {
      return context.json(apiError('CONFIGURATION_ERROR', 'El reporte de extracción no está disponible.'), 503)
    }
    const body = await context.req.json().catch(() => null)
    const parsed = extractionReportRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(apiError('VALIDATION_ERROR', 'El reporte del lote no es válido.'), 400)
    }
    try {
      const report = buildExtractionReport(parsed.data)
      const path = await reportWriter(report)
      console.log(`Reporte del lote: ${path}`)
      console.log(reportSummary(report))
      return context.json({ path })
    } catch {
      return context.json(apiError('UNKNOWN_ERROR', 'No se pudo escribir el reporte del lote.'), 500)
    }
  })

  app.post('/api/places/exa', async (context) => {
    if (!exaProvider?.configured) {
      return context.json(
        apiError('CONFIGURATION_ERROR', 'Falta configurar EXA_API_KEY en .env.local.'),
        503,
      )
    }

    const body = await context.req.json().catch(() => null)
    const parsed = exaRequestSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(apiError('VALIDATION_ERROR', 'El nombre del lugar no es válido.'), 400)
    }

    try {
      context.header('Cache-Control', 'no-store')
      const result: ExaPlaceResponse = await exaProvider.searchPlace(parsed.data.name, { refresh: parsed.data.refresh })
      return context.json(result)
    } catch (error) {
      if (error instanceof PlacesProviderError) {
        const mapped = providerError(error)
        return context.json(mapped.body, mapped.status)
      }
      return context.json(
        apiError('UNKNOWN_ERROR', 'No se pudo consultar Exa.'),
        500,
      )
    }
  })

  app.post('/api/place-matches/:source', async (context) => {
    const source = context.req.param('source') as MatchSource
    if (!matchSources.has(source)) {
      return context.json(apiError('VALIDATION_ERROR', 'La fuente solicitada no es válida.'), 400)
    }

    const providerForSource = matchProviders[source]
    if (!providerForSource) {
      return context.json(
        apiError('CONFIGURATION_ERROR', `La fuente ${source} no está disponible.`),
        503,
      )
    }

    const body = await context.req.json().catch(() => null)
    const parsed = anchorSchema.safeParse(body)
    if (!parsed.success) {
      return context.json(apiError('VALIDATION_ERROR', 'El lugar de referencia no es válido.'), 400)
    }

    try {
      context.header('Cache-Control', 'no-store')
      return context.json(await matchPlace(providerForSource, parsed.data.anchor))
    } catch (error) {
      if (error instanceof PlacesProviderError) {
        const mapped = providerError(error)
        return context.json(mapped.body, mapped.status)
      }
      return context.json(
        apiError('UNKNOWN_ERROR', `No se pudo consultar la fuente ${source}.`),
        500,
      )
    }
  })

  return app
}
