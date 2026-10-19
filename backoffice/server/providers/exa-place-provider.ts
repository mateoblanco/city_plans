import { Exa, ExaError, type DeepOutputSchema, type RegularSearchOptions } from 'exa-js'
import { z } from 'zod'
import type { ExaPlaceResponse, ExaPlaceResult, JsonValue } from '../../src/types/places.ts'
import { PlacesProviderError, type ProviderErrorKind } from './places-provider.ts'
import { isRateLimited, RateLimitError } from './rate-limit.ts'

type ExaSearchClient = {
  search(query: string, options: RegularSearchOptions): Promise<unknown>
}

const placeInfoSchema = z.object({
  description: z.string(),
  address: z.string(),
  contact_info: z.string(),
  open_hours_raw: z.string(),
  open_hours: z.array(z.object({
    days: z.string(),
    opens: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    closes: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  })),
  menu: z.array(z.string()),
  // Si Exa no lo devuelve, queda vacío en vez de invalidar la respuesta.
  instagram_profile_url: z.string().catch(''),
})

const exaResultSchema = z.object({
  title: z.string().catch(''),
  url: z.string().url(),
  highlights: z.array(z.string()).catch([]),
  text: z.string().optional(),
  extras: z.object({ links: z.array(z.string()).optional() }).optional(),
})

const searchResponseSchema = z.object({
  requestId: z.string(),
  results: z.array(exaResultSchema),
  output: z.object({
    content: placeInfoSchema,
    grounding: z.unknown(),
  }),
})

// Exa acepta hasta 10 propiedades en total, contando las anidadas (los items de open_hours suman 3):
// este schema ya usa las 10. Para sumar un campo hay que sacar otro.
export const EXA_PLACE_OUTPUT_SCHEMA = {
  description: 'Schema describing a place or venue, including its details, hours, and menu',
  type: 'object',
  required: [
    'description',
    'address',
    'contact_info',
    'open_hours_raw',
    'open_hours',
    'menu',
    'instagram_profile_url',
  ],
  properties: {
    description: {
      type: 'string',
      description: 'A brief description of the place',
    },
    address: {
      type: 'string',
      description: 'Physical address of the place',
    },
    contact_info: {
      type: 'string',
      description: 'Contact information exactly as published. Include available values using these labels: Phone: +598 ...; WhatsApp: +598 ...; Email: ...; Instagram: @handle; Web: https://official-site.example. Omit labels with no published value and never invent contact details.',
    },
    open_hours_raw: {
      type: 'string',
      description: 'Operating-hours text exactly as it appears in the source, without reinterpretation.',
    },
    open_hours: {
      type: 'array',
      description: 'Only exact hours published by a source. When only an opening time is published, use null for closes; use an empty array when no time is published. Never invent hours.',
      items: {
        type: 'object',
        required: ['days', 'opens', 'closes'],
        properties: {
          days: { type: 'string', description: 'Published day range, for example Mon-Sun, Tue-Sat, or Mon.' },
          opens: { type: 'string', description: 'Opening time in 24-hour HH:MM format.' },
          closes: { type: ['string', 'null'], description: 'Closing time in 24-hour HH:MM format, or null when not published.' },
        },
      },
    },
    menu: {
      type: 'array',
      description: 'List of menu items available at the place',
      items: {
        type: 'string',
        description: 'Name of the menu item',
      },
    },
    instagram_profile_url: {
      type: 'string',
      description: "Full URL of the place's official Instagram profile (https://www.instagram.com/<handle>/), or an empty string if it does not appear in the sources. Fill it only when the profile URL or @handle literally appears in the retrieved pages; never infer or construct it from the place name.",
    },
  },
} satisfies DeepOutputSchema & { description: string }

export const EXA_PLACE_SEARCH_OPTIONS: RegularSearchOptions = {
  // Priorizamos fuentes de alta señal: menos resultados también reduce el
  // contexto que luego se envía al modelo de extracción.
  numResults: 5,
  outputSchema: EXA_PLACE_OUTPUT_SCHEMA,
  stream: false,
  type: 'auto',
  contents: {
    text: { maxCharacters: 2_000 },
    highlights: true,
    extras: { links: 1 },
  },
}

// Búsqueda dirigida, sin resumen estructurado ni texto completo: sólo los highlights de
// cada resultado sobre el horario, que es lo único que se busca.
export const EXA_TEXT_SEARCH_OPTIONS: RegularSearchOptions = {
  numResults: 5,
  stream: false,
  type: 'auto',
  contents: {
    // Que los highlights traigan la dirección: el horario sólo se acepta si nombra la sucursal.
    highlights: { query: 'dirección y horario de atención de la sucursal' },
  },
}

export const EXA_INVALID_OUTPUT_RETRIES = 2

const textSearchResponseSchema = z.object({
  requestId: z.string(),
  results: z.array(exaResultSchema),
})

export interface ExaPlaceProvider {
  readonly configured: boolean
  searchPlace(name: string, request?: { refresh?: boolean }): Promise<ExaPlaceResponse>
  /** Búsqueda dirigida con la consulta tal cual (sólo highlights), por ejemplo para el horario de una sucursal. */
  searchText?(query: string): Promise<{ query: string; results: ExaPlaceResult[]; requestId: string }>
}

function errorKind(error: unknown): ProviderErrorKind {
  const statusCode = error instanceof ExaError
    ? error.statusCode
    : typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number(error.statusCode)
      : undefined

  if (statusCode === 401 || statusCode === 403) return 'authorization'
  if (statusCode === 429) return 'quota'
  if (statusCode === 408 || statusCode === 504) return 'timeout'
  return 'upstream'
}

function exaFailure(error: unknown): PlacesProviderError {
  if (isRateLimited(error)) return new RateLimitError('exa', 'Exa limitó temporalmente las consultas.', { cause: error })
  return new PlacesProviderError(errorKind(error), 'Exa no pudo completar la consulta.', { cause: error })
}

export class ExaPlaceSearchProvider implements ExaPlaceProvider {
  readonly configured: boolean
  private readonly client?: ExaSearchClient
  private readonly cache = new Map<string, Promise<ExaPlaceResponse>>()

  constructor(
    apiKey: string | undefined = process.env.EXA_API_KEY?.trim(),
    client?: ExaSearchClient,
  ) {
    this.configured = Boolean(apiKey)
    this.client = client ?? (this.configured ? new Exa() : undefined)
  }

  async searchPlace(name: string, request: { refresh?: boolean } = {}): Promise<ExaPlaceResponse> {
    const cacheKey = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ')
    if (request.refresh) this.cache.delete(cacheKey)
    const cached = this.cache.get(cacheKey)
    if (cached) return cached
    const pending = this.runSearch(name).catch((error) => {
      this.cache.delete(cacheKey)
      throw error
    })
    this.cache.set(cacheKey, pending)
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string)
    return pending
  }

  async searchText(query: string): Promise<{ query: string; results: ExaPlaceResult[]; requestId: string }> {
    if (!this.client) {
      throw new PlacesProviderError('configuration', 'Falta configurar EXA_API_KEY en .env.local.')
    }
    let result: unknown
    try {
      result = await this.client.search(query, EXA_TEXT_SEARCH_OPTIONS)
    } catch (error) {
      throw exaFailure(error)
    }
    const parsed = textSearchResponseSchema.safeParse(result)
    if (!parsed.success) throw new PlacesProviderError('upstream', 'Exa devolvió una respuesta inválida.')
    return { query, results: parsed.data.results, requestId: parsed.data.requestId }
  }

  private async runSearch(name: string): Promise<ExaPlaceResponse> {
    if (!this.client) {
      throw new PlacesProviderError(
        'configuration',
        'Falta configurar EXA_API_KEY en .env.local.',
      )
    }

    const query = `${name}, Montevideo, Uruguay`
    // La salida estructurada de Exa cambia entre llamadas y a veces no valida (un horario mal
    // formado, por ejemplo): se reintenta hasta EXA_INVALID_OUTPUT_RETRIES veces antes de fallar.
    let parsed: ReturnType<typeof searchResponseSchema.safeParse> | null = null
    for (let attempt = 0; attempt <= EXA_INVALID_OUTPUT_RETRIES && !parsed?.success; attempt += 1) {
      let result: unknown
      try {
        result = await this.client.search(query, EXA_PLACE_SEARCH_OPTIONS)
      } catch (error) {
        throw exaFailure(error)
      }
      parsed = searchResponseSchema.safeParse(result)
    }
    if (!parsed?.success) {
      throw new PlacesProviderError(
        'upstream',
        'Exa devolvió una respuesta estructurada inválida.',
      )
    }

    return {
      source: 'exa',
      query,
      output: {
        content: parsed.data.output.content,
        grounding: parsed.data.output.grounding as JsonValue,
      },
      results: parsed.data.results,
      requestId: parsed.data.requestId,
      attribution: 'Exa',
    }
  }
}
