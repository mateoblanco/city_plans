import { PlacesProviderError } from './places-provider.ts'

const ACTOR_TIMEOUT_SECONDS = 120
const CLIENT_TIMEOUT_GRACE_SECONDS = 10

export type GoogleOrganicResult = {
  url: string
  title: string
  description: string
  position: number
}

type ApifyOrganicResult = {
  url?: unknown
  title?: unknown
  description?: unknown
  position?: unknown
}

type ApifySearchPage = {
  organicResults?: unknown
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorDetail(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const error = (payload as Record<string, unknown>).error
  if (!error || typeof error !== 'object') return ''
  const message = (error as Record<string, unknown>).message
  return typeof message === 'string' && message.trim() ? ` ${message.trim()}` : ''
}

export class ApifyGoogleSearchProvider {
  readonly configured: boolean
  private readonly token: string
  private readonly actorId: string
  private readonly fetcher: typeof fetch

  constructor(
    config: { token?: string; actorId?: string },
    fetcher: typeof fetch = fetch,
  ) {
    this.token = config.token?.trim() ?? ''
    this.actorId = config.actorId?.trim() || 'apify~google-search-scraper'
    this.configured = Boolean(this.token)
    this.fetcher = fetcher
  }

  async search(query: string): Promise<GoogleOrganicResult[]> {
    if (!this.configured) {
      throw new PlacesProviderError(
        'configuration',
        'Falta configurar APIFY_API_TOKEN para buscar fuentes en Google.',
      )
    }

    const endpoint = new URL(
      `https://api.apify.com/v2/actors/${encodeURIComponent(this.actorId)}/run-sync-get-dataset-items`,
    )
    endpoint.searchParams.set('clean', 'true')
    endpoint.searchParams.set('format', 'json')
    endpoint.searchParams.set('timeout', String(ACTOR_TIMEOUT_SECONDS))

    let response: Response
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          queries: query,
          maxPagesPerQuery: 1,
          countryCode: 'uy',
          languageCode: 'es',
          mobileResults: false,
          includeUnfilteredResults: false,
          saveHtml: false,
        }),
        signal: AbortSignal.timeout(
          (ACTOR_TIMEOUT_SECONDS + CLIENT_TIMEOUT_GRACE_SECONDS) * 1_000,
        ),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new PlacesProviderError('timeout', 'Google Search demoró demasiado en responder.')
      }
      throw new PlacesProviderError(
        'upstream',
        'No se pudo conectar con Apify para buscar fuentes en Google.',
        { cause: error },
      )
    }

    if (response.status === 401 || response.status === 403) {
      throw new PlacesProviderError('authorization', 'Apify rechazó el token configurado.')
    }
    if (response.status === 402 || response.status === 429) {
      throw new PlacesProviderError('quota', 'Apify no tiene crédito disponible o limitó la consulta.')
    }
    if (response.status === 408 || response.status === 504) {
      throw new PlacesProviderError('timeout', 'Google Search demoró demasiado en responder.')
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      const detail = errorDetail(payload)
      if (/timed[ -]?out|timeout/i.test(detail)) {
        throw new PlacesProviderError(
          'timeout',
          'Google Search demoró demasiado en responder en Apify.',
        )
      }
      throw new PlacesProviderError(
        'upstream',
        `Apify no pudo completar la búsqueda en Google.${detail}`,
      )
    }

    const pages = (await response.json()) as unknown
    if (!Array.isArray(pages)) return []

    return pages.flatMap((page, pageIndex) => {
      if (!page || typeof page !== 'object') return []
      const organicResults = (page as ApifySearchPage).organicResults
      if (!Array.isArray(organicResults)) return []

      return organicResults.flatMap((entry, resultIndex) => {
        if (!entry || typeof entry !== 'object') return []
        const result = entry as ApifyOrganicResult
        const url = stringValue(result.url)
        if (!url) return []
        const position = typeof result.position === 'number' && Number.isFinite(result.position)
          ? result.position
          : pageIndex * 10 + resultIndex + 1
        return [{
          url,
          title: stringValue(result.title),
          description: stringValue(result.description),
          position,
        }]
      })
    }).sort((left, right) => left.position - right.position)
  }
}
