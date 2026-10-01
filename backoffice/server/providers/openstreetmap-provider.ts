import type { JsonValue, MatchSource, PlaceAnchor } from '../../src/types/places.ts'
import type {
  PlaceMatchProvider,
  RawPlaceCandidate,
} from './place-match-provider.ts'
import { PlacesProviderError } from './places-provider.ts'

type OsmElement = {
  type?: string
  id?: number
  lat?: number
  lon?: number
  center?: { lat?: number; lon?: number }
  tags?: Record<string, string>
}

type OverpassResponse = {
  elements?: OsmElement[]
  [key: string]: unknown
}

type CacheEntry = {
  expiresAt: number
  elements: OsmElement[]
}

export type OpenStreetMapConfig = {
  endpoint: string
  userAgent: string
}

const OSM_ALTERNATIVE_NAME_KEYS = [
  'name:es',
  'official_name',
  'alt_name',
  'short_name',
  'brand',
  'operator',
] as const

export function openStreetMapAlternativeNames(
  tags: Record<string, string>,
  primaryName: string,
): string[] {
  const names = OSM_ALTERNATIVE_NAME_KEYS.flatMap((key) =>
    (tags[key] ?? '').split(';').map((name) => name.trim()).filter(Boolean),
  )
  return [...new Set(names)].filter((name) => name !== primaryName)
}

export class OpenStreetMapProvider implements PlaceMatchProvider {
  readonly source: MatchSource = 'openstreetmap'
  readonly attribution = '© OpenStreetMap contributors · ODbL'
  readonly configured: boolean
  private readonly cache = new Map<string, CacheEntry>()
  private queue: Promise<void> = Promise.resolve()
  private readonly config: OpenStreetMapConfig
  private readonly fetcher: typeof fetch

  constructor(
    config: OpenStreetMapConfig,
    fetcher: typeof fetch = fetch,
  ) {
    this.config = config
    this.fetcher = fetcher
    this.configured = Boolean(config.endpoint && config.userAgent)
  }

  async findCandidates(anchor: PlaceAnchor): Promise<RawPlaceCandidate[]> {
    if (!this.configured) {
      throw new PlacesProviderError(
        'configuration',
        'OpenStreetMap requiere OSM_OVERPASS_URL y un OSM_USER_AGENT identificable.',
      )
    }

    const elements = await this.getElements(anchor)
    return elements.flatMap((element) => {
      const name = element.tags?.name?.trim()
      const latitude = element.lat ?? element.center?.lat
      const longitude = element.lon ?? element.center?.lon
      if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return []

      const tags = element.tags ?? {}
      const address = [
        tags['addr:street'],
        tags['addr:housenumber'],
        tags['addr:city'],
      ].filter(Boolean).join(' ')

      return [{
        name,
        alternativeNames: openStreetMapAlternativeNames(tags, name),
        address,
        latitude: latitude as number,
        longitude: longitude as number,
        data: element as unknown as JsonValue,
      }]
    })
  }

  private async getElements(anchor: PlaceAnchor): Promise<OsmElement[]> {
    const key = `${anchor.latitude.toFixed(5)},${anchor.longitude.toFixed(5)}`
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.elements

    const result = new Promise<OsmElement[]>((resolve, reject) => {
      this.queue = this.queue
        .catch(() => undefined)
        .then(async () => {
          try {
            resolve(await this.fetchElements(anchor))
          } catch (error) {
            reject(error)
          }
        })
    })

    const elements = await result
    this.cache.set(key, { expiresAt: Date.now() + 10 * 60_000, elements })
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string)
    return elements
  }

  private async fetchElements(anchor: PlaceAnchor): Promise<OsmElement[]> {
    const query = `[out:json][timeout:15];nwr(around:150,${anchor.latitude},${anchor.longitude})["name"];out tags center qt;`
    let response: Response
    try {
      response = await this.fetcher(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.config.userAgent,
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new PlacesProviderError('timeout', 'OpenStreetMap demoró demasiado en responder.')
      }
      throw new PlacesProviderError(
        'upstream',
        'No se pudo conectar con OpenStreetMap.',
        { cause: error },
      )
    }

    if (response.status === 429) {
      throw new PlacesProviderError('quota', 'OpenStreetMap limitó temporalmente las consultas.')
    }
    if (!response.ok) {
      throw new PlacesProviderError('upstream', 'OpenStreetMap no pudo completar la consulta.')
    }

    const payload = (await response.json()) as OverpassResponse
    return payload.elements ?? []
  }
}
