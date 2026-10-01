import type { JsonValue, MatchSource, PlaceAnchor } from '../../src/types/places.ts'
import { queryJson, withDuckDB } from './duckdb.ts'
import type {
  PlaceMatchProvider,
  RawPlaceCandidate,
} from './place-match-provider.ts'
import { PlacesProviderError } from './places-provider.ts'

const OVERTURE_STAC_URL = 'https://stac.overturemaps.org/catalog.json'
const RELEASE_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/

type StacCatalog = { latest?: unknown }

function objectValue(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
}

function uniqueNames(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))]
}

export function overtureNames(row: Record<string, JsonValue>): {
  primary: string
  alternatives: string[]
} {
  const names = objectValue(row.names)
  const primary = typeof names?.primary === 'string' ? names.primary : ''
  const alternatives: string[] = []
  const common = objectValue(names?.common)
  if (common) {
    for (const value of Object.values(common)) {
      if (typeof value === 'string') alternatives.push(value)
      if (Array.isArray(value)) {
        alternatives.push(...value.filter((item): item is string => typeof item === 'string'))
      }
    }
  }

  if (Array.isArray(names?.rules)) {
    for (const rule of names.rules) {
      const value = objectValue(rule)?.value
      if (typeof value === 'string') alternatives.push(value)
    }
  }

  return {
    primary,
    alternatives: uniqueNames(alternatives).filter((name) => name !== primary),
  }
}

function firstAddress(row: Record<string, JsonValue>): string {
  if (!Array.isArray(row.addresses)) return ''
  const first = objectValue(row.addresses[0])
  return typeof first?.freeform === 'string' ? first.freeform : ''
}

export class OvertureProvider implements PlaceMatchProvider {
  readonly source: MatchSource = 'overture'
  readonly attribution = 'Overture Maps Foundation'
  readonly configured = true
  private releasePromise?: Promise<string>
  private readonly fetcher: typeof fetch

  constructor(fetcher: typeof fetch = fetch) {
    this.fetcher = fetcher
  }

  private async getRelease(): Promise<string> {
    this.releasePromise ??= this.fetcher(OVERTURE_STAC_URL)
      .then(async (response) => {
        if (!response.ok) throw new Error(`STAC respondió ${response.status}`)
        const payload = (await response.json()) as StacCatalog
        if (typeof payload.latest !== 'string' || !RELEASE_PATTERN.test(payload.latest)) {
          throw new Error('El catálogo STAC no informó una release válida.')
        }
        return payload.latest
      })
      .catch((error) => {
        this.releasePromise = undefined
        throw error
      })
    return this.releasePromise
  }

  async findCandidates(anchor: PlaceAnchor): Promise<RawPlaceCandidate[]> {
    const latitudeDelta = 150 / 111_320
    const longitudeDelta = latitudeDelta / Math.cos((anchor.latitude * Math.PI) / 180)

    try {
      const release = await this.getRelease()
      const source = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`
      const rows = await withDuckDB(async (connection) => {
        await connection.run("SET s3_region='us-west-2';")
        return queryJson(
          connection,
          `SELECT * EXCLUDE (geometry), ST_AsGeoJSON(geometry) AS geometry_geojson
           FROM read_parquet(?)
           WHERE bbox.xmin BETWEEN ? AND ? AND bbox.ymin BETWEEN ? AND ?
           ORDER BY power(bbox.xmin - ?, 2) + power(bbox.ymin - ?, 2)
           LIMIT 250`,
          [
            source,
            anchor.longitude - longitudeDelta,
            anchor.longitude + longitudeDelta,
            anchor.latitude - latitudeDelta,
            anchor.latitude + latitudeDelta,
            anchor.longitude,
            anchor.latitude,
          ],
        )
      })

      return rows.flatMap((row) => {
        const names = overtureNames(row)
        const bbox = objectValue(row.bbox)
        const latitude = typeof bbox?.ymin === 'number' ? bbox.ymin : Number.NaN
        const longitude = typeof bbox?.xmin === 'number' ? bbox.xmin : Number.NaN
        if (!names.primary || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return []
        return [{
          name: names.primary,
          alternativeNames: names.alternatives,
          address: firstAddress(row),
          latitude,
          longitude,
          data: row,
        }]
      })
    } catch (error) {
      throw new PlacesProviderError(
        'upstream',
        'No se pudo consultar Overture Maps.',
        { cause: error },
      )
    }
  }
}
