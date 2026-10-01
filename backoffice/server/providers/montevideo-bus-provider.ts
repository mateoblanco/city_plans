import distance from '@turf/distance'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const INITIAL_SEARCH_RADIUS_METERS = 350
const FALLBACK_SEARCH_RADIUS_METERS = 500

// Se exporta para que el catálogo pueda ajustarse sin tocar la lógica de proximidad.
export const EXCLUDED_LINES = ['CARNAVAL'] as const
const REGULAR_LINE_PATTERN = /^(?:\d{1,3}(?: SD)?|(?:BT|CE|D|E|G|L)\d{1,2}|G|M-[AB]|PA|PB)$/i

export type NearbyBusLine = {
  line: string
  stopId: string
  meters: number
}

export type TransitInfo = {
  status: 'success' | 'partial' | 'unavailable'
  lines: NearbyBusLine[]
}

type Stop = { id: string; longitude: number; latitude: number; lines: string[] }
type GeoJsonFeature = {
  geometry?: { coordinates?: unknown }
  properties?: Record<string, unknown>
}
type GeoJson = { features?: GeoJsonFeature[] }

function defaultStopsPath() {
  return fileURLToPath(new URL('../data/paradas.json', import.meta.url))
}

function isWgs84(longitude: number, latitude: number) {
  return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90
}

export function isRegularLine(line: string) {
  const normalized = line.trim().toUpperCase()
  return Boolean(normalized) && !EXCLUDED_LINES.includes(normalized as typeof EXCLUDED_LINES[number]) && REGULAR_LINE_PATTERN.test(normalized)
}

function parseStops(payload: unknown): Stop[] {
  const collection = payload as GeoJson
  if (!Array.isArray(collection.features)) throw new Error('paradas.json no contiene una colección GeoJSON válida.')

  const stops = new Map<string, Stop>()
  for (const feature of collection.features) {
    const id = feature.properties?.COD_UBIC_P
    const line = feature.properties?.DESC_LINEA
    const coordinates = feature.geometry?.coordinates
    if ((typeof id !== 'number' && typeof id !== 'string') || !Array.isArray(coordinates)) {
      throw new Error('paradas.json no contiene el campo COD_UBIC_P o una geometría válida.')
    }
    const [longitude, latitude] = coordinates
    if (typeof longitude !== 'number' || typeof latitude !== 'number' || !isWgs84(longitude, latitude)) {
      throw new Error('paradas.json contiene coordenadas fuera de WGS84 (posible UTM 21S).')
    }
    const stopId = String(id)
    const stop = stops.get(stopId) ?? { id: stopId, longitude, latitude, lines: [] }
    if (typeof line === 'string' && isRegularLine(line) && !stop.lines.includes(line.trim())) stop.lines.push(line.trim())
    stops.set(stopId, stop)
  }
  return [...stops.values()]
}

export class MontevideoBusProvider {
  readonly configured: boolean
  private readonly clientId?: string
  private readonly clientSecret?: string
  private readonly stopsPath: string
  private stopsPromise?: Promise<Stop[]>

  constructor(config: {
    clientId?: string
    clientSecret?: string
    stopsPath?: string
    // Se conserva por compatibilidad de construcción; ya no se consulta la API remota.
    fetcher?: typeof fetch
    now?: () => number
  } = {}) {
    this.clientId = config.clientId?.trim()
    this.clientSecret = config.clientSecret?.trim()
    this.configured = Boolean(this.clientId && this.clientSecret)
    this.stopsPath = config.stopsPath ?? defaultStopsPath()
  }

  async findNearbyLines(latitude: number, longitude: number): Promise<TransitInfo> {
    let nearbyStops: { stop: Stop; meters: number }[]
    try {
      const stops = await this.loadStops()
      const stopsWithin = (radius: number) => stops.flatMap((stop) => {
        const meters = distance([longitude, latitude], [stop.longitude, stop.latitude], { units: 'kilometers' }) * 1000
        return meters <= radius ? [{ stop, meters: Math.round(meters) }] : []
      })
      nearbyStops = stopsWithin(INITIAL_SEARCH_RADIUS_METERS)
      if (nearbyStops.length === 0) nearbyStops = stopsWithin(FALLBACK_SEARCH_RADIUS_METERS)
    } catch {
      return { status: 'unavailable', lines: [] }
    }

    if (nearbyStops.length === 0) return { status: 'success', lines: [] }

    // paradas.json ya contiene la relación línea ↔ parada. Usarla como índice
    // en memoria evita autenticar/consultar variantes remotas por extracción.
    const lines = new Map<string, NearbyBusLine>()
    for (const { stop, meters } of nearbyStops) {
      for (const line of stop.lines) {
        const previous = lines.get(line)
        if (!previous || meters < previous.meters) {
          lines.set(line, { line, stopId: stop.id, meters })
        }
      }
    }

    const allLines = [...lines.values()]
    return {
      status: 'success',
      lines: allLines.sort((a, b) => a.line.localeCompare(b.line, 'es', { numeric: true, sensitivity: 'base' })),
    }
  }

  private async loadStops() {
    this.stopsPromise ??= readFile(this.stopsPath, 'utf8').then((contents) => parseStops(JSON.parse(contents)))
    return this.stopsPromise
  }

}
