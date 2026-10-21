import bbox from '@turf/bbox'
import booleanIntersects from '@turf/boolean-intersects'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import distance from '@turf/distance'
import { polygon as turfPolygon } from '@turf/helpers'
import type { Feature, Polygon } from 'geojson'
import { getNeighborhoodFeature } from '../../src/lib/getNeighborhood.ts'
import type { CategoryId } from '../../src/data/tags.ts'
import type {
  FailedSweepCall,
  NeighborhoodSweepEvent,
  NeighborhoodSweepMode,
  NeighborhoodSweepPlace,
  NeighborhoodSweepSummary,
  SaturatedCell,
  SweepBounds,
  SweepCallCounts,
} from '../../src/types/places.ts'
import {
  CALL_DELAY_MS,
  DEFAULT_MAX_CALLS,
  MAX_PAGES_PER_QUERY,
  MAX_RETRIES,
  MIN_CELL_METERS,
  PAGE_RETRY_DELAY_MS,
  PAGE_SIZE,
  RESCUE_QUERIES,
  RESCUE_SEED_CATEGORY,
  RESCUE_TYPE,
  SUBDIVIDE_THRESHOLD,
  SWEEP_TYPES,
} from './neighborhood-sweep-config.ts'
import { UNKNOWN_TYPE_PREFIX, classifyPlace } from './place-prefilter.ts'
import { PlacesProviderError } from './places-provider.ts'

const GOOGLE_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

// "full" factura Text Search Enterprise (por rating y userRatingCount). "ids" factura Text Search Essentials (IDs Only), sin costo,
// pero no trae ubicación ni nombre: no se puede filtrar por polígono. containingPlaces es Pro: dentro de Enterprise no cambia el SKU.
const FIELD_MASKS: Record<NeighborhoodSweepMode, string> = {
  full: [
    'places.id',
    'places.location',
    'places.types',
    'places.displayName',
    'places.googleMapsUri',
    'places.primaryTypeDisplayName',
    'places.primaryType',
    'places.businessStatus',
    'places.rating',
    'places.userRatingCount',
    'places.containingPlaces',
    'nextPageToken',
  ].join(','),
  ids: ['places.id', 'nextPageToken'].join(','),
}

type GooglePlace = {
  id?: string
  displayName?: { text?: string }
  primaryTypeDisplayName?: { text?: string }
  googleMapsUri?: string
  types?: string[]
  primaryType?: string
  businessStatus?: string
  rating?: number
  userRatingCount?: number
  location?: { latitude?: number; longitude?: number }
  containingPlaces?: { id?: string }[]
}

type GoogleSearchResponse = {
  places?: GooglePlace[]
  nextPageToken?: string
}

type QueryRun = {
  kind: keyof SweepCallCounts
  key: string
  textQuery: string
  googleType: string
  seedCategory: CategoryId
}

type QueryOutcome =
  | { ok: true; resultCount: number; newPlaces: number }
  | { ok: false }

export type NeighborhoodSweeperOptions = {
  apiKey: string
  fetcher?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxCalls?: number
  minCellMeters?: number
  subdivideThreshold?: number
}

export type SweepRunOptions = {
  mode?: NeighborhoodSweepMode
  signal?: AbortSignal
  onEvent?: (event: NeighborhoodSweepEvent) => void
}

export type NeighborhoodSweepResult = {
  places: NeighborhoodSweepPlace[]
  summary: NeighborhoodSweepSummary
}

export interface NeighborhoodSweeper {
  readonly maxCalls: number
  sweep(neighborhoodId: string, options?: SweepRunOptions): Promise<NeighborhoodSweepResult>
}

class SweepStopped extends Error {}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function boundsKey(bounds: SweepBounds) {
  return [bounds.south, bounds.west, bounds.north, bounds.east].map((value) => value.toFixed(6)).join(',')
}

function cellSizeMeters(bounds: SweepBounds) {
  const midLat = (bounds.south + bounds.north) / 2
  const midLng = (bounds.west + bounds.east) / 2
  return {
    width: distance([bounds.west, midLat], [bounds.east, midLat], { units: 'meters' }),
    height: distance([midLng, bounds.south], [midLng, bounds.north], { units: 'meters' }),
  }
}

/** Divide la celda en 4 (o en 2 si un lado ya no admite mitades ≥ mínimo). Vacío = celda mínima. */
export function splitCell(bounds: SweepBounds, minMeters = MIN_CELL_METERS): SweepBounds[] {
  const { width, height } = cellSizeMeters(bounds)
  const splitLng = width / 2 >= minMeters
  const splitLat = height / 2 >= minMeters
  if (!splitLng && !splitLat) return []

  const midLat = (bounds.south + bounds.north) / 2
  const midLng = (bounds.west + bounds.east) / 2
  const lats = splitLat ? [[bounds.south, midLat], [midLat, bounds.north]] : [[bounds.south, bounds.north]]
  const lngs = splitLng ? [[bounds.west, midLng], [midLng, bounds.east]] : [[bounds.west, bounds.east]]
  return lats.flatMap(([south, north]) => lngs.map(([west, east]) => ({ south, west, north, east })))
}

function toPolygon(bounds: SweepBounds) {
  const { south, west, north, east } = bounds
  return turfPolygon([[[west, south], [east, south], [east, north], [west, north], [west, south]]])
}

function addUnique<T>(list: T[], value: T) {
  if (!list.includes(value)) list.push(value)
}

export class GoogleNeighborhoodSweeper implements NeighborhoodSweeper {
  readonly maxCalls: number
  private readonly apiKey: string
  private readonly fetcher: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly minCellMeters: number
  private readonly subdivideThreshold: number

  constructor({
    apiKey,
    fetcher = fetch,
    sleep = defaultSleep,
    maxCalls = DEFAULT_MAX_CALLS,
    minCellMeters = MIN_CELL_METERS,
    subdivideThreshold = SUBDIVIDE_THRESHOLD,
  }: NeighborhoodSweeperOptions) {
    this.apiKey = apiKey
    this.fetcher = fetcher
    this.sleep = sleep
    this.maxCalls = maxCalls
    this.minCellMeters = minCellMeters
    this.subdivideThreshold = subdivideThreshold
  }

  async sweep(neighborhoodId: string, { mode = 'full', signal, onEvent }: SweepRunOptions = {}): Promise<NeighborhoodSweepResult> {
    const feature = getNeighborhoodFeature(neighborhoodId)
    if (!feature) {
      throw new PlacesProviderError('validation', 'El barrio no está permitido.')
    }
    const polygon = feature as unknown as Feature<Polygon>
    const [west, south, east, north] = bbox(polygon)
    const root: SweepBounds = { south, west, north, east }

    const places = new Map<string, NeighborhoodSweepPlace>()
    let outsideCount = 0
    const newByQuery: Record<string, number> = {}
    const saturated = new Map<string, SaturatedCell>()
    const failedCalls: FailedSweepCall[] = []
    const apiCalls: SweepCallCounts = { sweep: 0, rescue: 0 }
    let truncated = false
    let callsMade = 0

    const emit = (event: NeighborhoodSweepEvent) => onEvent?.(event)

    const callGoogle = async (body: Record<string, unknown>, run: QueryRun): Promise<GoogleSearchResponse> => {
      for (let attempt = 0; ; attempt += 1) {
        if (signal?.aborted) throw new SweepStopped()
        if (callsMade >= this.maxCalls) {
          truncated = true
          throw new SweepStopped()
        }
        if (callsMade > 0) await this.sleep(attempt === 0 ? CALL_DELAY_MS : CALL_DELAY_MS * 2 ** attempt)
        if (signal?.aborted) throw new SweepStopped()

        callsMade += 1
        apiCalls[run.kind] += 1

        let response: Response
        try {
          response = await this.fetcher(GOOGLE_TEXT_SEARCH_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': this.apiKey,
              'X-Goog-FieldMask': FIELD_MASKS[mode],
            },
            body: JSON.stringify(body),
            signal,
          })
        } catch (error) {
          if (signal?.aborted) throw new SweepStopped()
          if (attempt < MAX_RETRIES) continue
          throw new PlacesProviderError('upstream', 'No se pudo conectar con Google Places.', { cause: error })
        }

        if (response.ok) return (await response.json()) as GoogleSearchResponse
        if (response.status === 401 || response.status === 403) {
          throw new PlacesProviderError('authorization', 'Google Places rechazó las credenciales configuradas.')
        }
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) continue
        throw new PlacesProviderError(
          response.status === 429 ? 'quota' : 'upstream',
          `Google Places respondió ${response.status}.`,
        )
      }
    }

    const upsert = (place: GooglePlace, run: QueryRun): { changed: NeighborhoodSweepPlace | null; isNew: boolean } => {
      const placeId = place.id
      if (!placeId) return { changed: null, isNew: false }
      const name = mode === 'ids' ? placeId : place.displayName?.text
      const lat = place.location?.latitude
      const lng = place.location?.longitude
      if (mode === 'full' && (!name || !Number.isFinite(lat) || !Number.isFinite(lng))) return { changed: null, isNew: false }

      const existing = places.get(placeId)
      if (!existing) {
        // Los lugares de afuera se conservan marcados para que la UI pueda mostrarlos,
        // pero no cuentan en totales ni en el aporte de cada consulta.
        const insideNeighborhood = mode === 'full'
          ? booleanPointInPolygon([lng as number, lat as number], polygon)
          : null
        const created: NeighborhoodSweepPlace = {
          placeId,
          name: name as string,
          type: place.primaryTypeDisplayName?.text ?? (mode === 'ids' ? 'Sólo ID' : 'Lugar gastronómico'),
          googleMapsUri:
            place.googleMapsUri ??
            `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`,
          seedCategories: [run.seedCategory],
          googleTypes: place.types ?? [],
          foundBy: [run.key],
          insideNeighborhood,
          ...(mode === 'full'
            ? classifyPlace(place)
            : { group: null, reason: null }),
          primaryType: place.primaryType ?? null,
          rating: place.rating ?? null,
          userRatingCount: place.userRatingCount ?? null,
          location: mode === 'full' ? { lat: lat as number, lng: lng as number } : null,
          containedIn: (place.containingPlaces ?? []).flatMap((container) => (container.id ? [container.id] : [])),
        }
        places.set(placeId, created)
        if (insideNeighborhood === false) {
          outsideCount += 1
          return { changed: created, isNew: false }
        }
        newByQuery[run.key] = (newByQuery[run.key] ?? 0) + 1
        return { changed: created, isNew: true }
      }

      const before = existing.seedCategories.length + existing.foundBy.length
      addUnique(existing.seedCategories, run.seedCategory)
      addUnique(existing.foundBy, run.key)
      const changed = existing.seedCategories.length + existing.foundBy.length !== before
      return { changed: changed ? { ...existing, seedCategories: [...existing.seedCategories], foundBy: [...existing.foundBy] } : null, isNew: false }
    }

    const runQuery = async (run: QueryRun, cell: SweepBounds): Promise<QueryOutcome> => {
      newByQuery[run.key] ??= 0
      let resultCount = 0
      let newPlaces = 0
      let pageToken: string | undefined

      for (let page = 0; page < MAX_PAGES_PER_QUERY; page += 1) {
        const body: Record<string, unknown> = {
          textQuery: run.textQuery,
          includedType: run.googleType,
          strictTypeFiltering: true,
          locationRestriction: {
            rectangle: {
              low: { latitude: cell.south, longitude: cell.west },
              high: { latitude: cell.north, longitude: cell.east },
            },
          },
          pageSize: PAGE_SIZE,
          languageCode: 'es',
          regionCode: 'UY',
        }
        if (pageToken) body.pageToken = pageToken

        const attempt = async (): Promise<{ payload: GoogleSearchResponse } | { error: unknown }> => {
          try {
            return { payload: await callGoogle(body, run) }
          } catch (error) {
            if (error instanceof SweepStopped) throw error
            if (error instanceof PlacesProviderError && error.kind === 'authorization') throw error
            return { error }
          }
        }

        let outcome = await attempt()
        if ('error' in outcome && pageToken) {
          // Página intermedia: una pausa más larga antes de un último intento con el mismo token.
          await this.sleep(PAGE_RETRY_DELAY_MS)
          outcome = await attempt()
        }
        if ('error' in outcome) {
          failedCalls.push({
            key: run.key,
            bounds: cell,
            page: page + 1,
            message: outcome.error instanceof Error ? outcome.error.message : 'Error desconocido.',
          })
          return { ok: false }
        }
        const payload = outcome.payload

        const results = payload.places ?? []
        resultCount += results.length
        const changed: NeighborhoodSweepPlace[] = []
        for (const place of results) {
          const outcome = upsert(place, run)
          if (outcome.isNew) newPlaces += 1
          if (outcome.changed) changed.push(outcome.changed)
        }
        if (changed.length > 0) emit({ type: 'places', items: changed })
        emit({ type: 'progress', apiCalls: { ...apiCalls }, totalPlaces: places.size - outsideCount, discardedOutside: outsideCount, currentQuery: run.key })

        pageToken = payload.nextPageToken || undefined
        if (!pageToken) break
      }

      return { ok: true, resultCount, newPlaces }
    }

    const rescue = async (cell: SweepBounds, cause: QueryRun) => {
      const key = boundsKey(cell)
      const existing = saturated.get(key)
      if (existing) {
        existing.saturatedBy.push({ googleType: cause.googleType, query: cause.textQuery })
        return
      }
      const record: SaturatedCell = {
        bounds: cell,
        saturatedBy: [{ googleType: cause.googleType, query: cause.textQuery }],
        rescueNewPlaces: 0,
      }
      saturated.set(key, record)
      for (const textQuery of RESCUE_QUERIES) {
        const outcome = await runQuery({
          kind: 'rescue',
          key: `rescate:${textQuery}`,
          textQuery,
          googleType: RESCUE_TYPE,
          seedCategory: RESCUE_SEED_CATEGORY,
        }, cell)
        if (outcome.ok) record.rescueNewPlaces += outcome.newPlaces
      }
    }

    emit({ type: 'start', neighborhoodId, mode, maxCalls: this.maxCalls })

    try {
      for (const type of SWEEP_TYPES) {
        for (const textQuery of type.queries) {
          const run: QueryRun = {
            kind: 'sweep',
            key: `${type.seedCategory}:${textQuery}`,
            textQuery,
            googleType: type.googleType,
            seedCategory: type.seedCategory,
          }
          // La subdivisión es independiente por consulta.
          const queue: SweepBounds[] = [root]
          while (queue.length > 0) {
            const cell = queue.shift() as SweepBounds
            if (!booleanIntersects(toPolygon(cell), polygon)) continue

            const outcome = await runQuery(run, cell)
            if (!outcome.ok || outcome.resultCount < this.subdivideThreshold) continue

            const children = splitCell(cell, this.minCellMeters)
            if (children.length > 0) queue.push(...children)
            else await rescue(cell, run)
          }
        }
      }
    } catch (error) {
      if (!(error instanceof SweepStopped)) throw error
    }

    const list = [...places.values()]
    const bySeedCategory: Partial<Record<CategoryId, number>> = {}
    const byGroup = mode === 'full' ? { accepted: 0, review: 0, rejected: 0 } : null
    const byReason: Record<string, number> = {}
    const unknownTypes: Record<string, number> = {}
    for (const place of list) {
      if (place.insideNeighborhood === false) continue
      if (place.group && byGroup) byGroup[place.group] += 1
      if (place.reason) byReason[place.reason] = (byReason[place.reason] ?? 0) + 1
      if (place.reason?.startsWith(UNKNOWN_TYPE_PREFIX)) {
        const type = place.reason.slice(UNKNOWN_TYPE_PREFIX.length)
        unknownTypes[type] = (unknownTypes[type] ?? 0) + 1
      }
      for (const category of place.seedCategories) {
        bySeedCategory[category] = (bySeedCategory[category] ?? 0) + 1
      }
    }

    const summary: NeighborhoodSweepSummary = {
      neighborhoodId,
      mode,
      totalPlaces: list.length - outsideCount,
      bySeedCategory,
      byGroup,
      byReason,
      unknownTypes,
      newByQuery,
      saturatedCells: [...saturated.values()],
      discardedOutside: outsideCount,
      apiCalls,
      failedCalls,
      failedCallCount: failedCalls.length,
      failedPageCount: failedCalls.filter((call) => call.page > 1).length,
      truncated,
      maxCalls: this.maxCalls,
    }
    return { places: list, summary }
  }
}
