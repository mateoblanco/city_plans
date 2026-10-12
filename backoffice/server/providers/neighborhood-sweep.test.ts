import bbox from '@turf/bbox'
import booleanIntersects from '@turf/boolean-intersects'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { polygon as turfPolygon } from '@turf/helpers'
import type { Feature, Polygon } from 'geojson'
import { describe, expect, it, vi } from 'vitest'
import { getNeighborhoodFeature } from '../../src/lib/getNeighborhood.ts'
import { NEIGHBORHOOD_NAMES } from '../../src/data/neighborhood-names.ts'
import { NEIGHBORHOOD_IDS } from '../../src/lib/getNeighborhood.ts'
import type { NeighborhoodSweepEvent, SweepBounds } from '../../src/types/places.ts'
import { RESCUE_QUERIES, SWEEP_TYPES } from './neighborhood-sweep-config.ts'
import { GoogleNeighborhoodSweeper, boundsKey, splitCell } from './neighborhood-sweep.ts'

const NEIGHBORHOOD = 'PARQUE RODO'
const feature = getNeighborhoodFeature(NEIGHBORHOOD) as unknown as Feature<Polygon>
const [west, south, east, north] = bbox(feature)
const root: SweepBounds = { south, west, north, east }
const totalQueries = SWEEP_TYPES.reduce((sum, type) => sum + type.queries.length, 0)

function findInsidePoint() {
  for (let i = 1; i < 20; i += 1) {
    for (let j = 1; j < 20; j += 1) {
      const lng = west + ((east - west) * i) / 20
      const lat = south + ((north - south) * j) / 20
      if (booleanPointInPolygon([lng, lat], feature)) return { latitude: lat, longitude: lng }
    }
  }
  throw new Error('No se encontró un punto dentro del barrio.')
}

const inside = findInsidePoint()
const outside = { latitude: south - 0.01, longitude: west - 0.01 }

type SearchBody = {
  textQuery: string
  includedType: string
  strictTypeFiltering: boolean
  pageSize: number
  pageToken?: string
  locationRestriction: { rectangle: { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } }
}

type Responder = (body: SearchBody, bounds: SweepBounds) => Response | { places?: unknown[]; nextPageToken?: string }

function place(id: string, location = inside, types = ['restaurant']) {
  return { id, displayName: { text: `Lugar ${id}` }, location, types, googleMapsUri: `https://maps.google.com/${id}` }
}

function boundsOf(body: SearchBody): SweepBounds {
  const { low, high } = body.locationRestriction.rectangle
  return { south: low.latitude, west: low.longitude, north: high.latitude, east: high.longitude }
}

function setup(responder: Responder, options: { maxCalls?: number; minCellMeters?: number; subdivideThreshold?: number } = {}) {
  const calls: SearchBody[] = []
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as SearchBody
    calls.push(body)
    const result = responder(body, boundsOf(body))
    return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200 })
  })
  const sleep = vi.fn(async (_ms: number) => undefined)
  const sweeper = new GoogleNeighborhoodSweeper({ apiKey: 'secret-key', fetcher: fetcher as typeof fetch, sleep, ...options })
  return { sweeper, calls, sleep, fetcher }
}

/** Devuelve 60 lugares únicos para la celda (3 páginas de 20). */
function saturatedPages(body: SearchBody, bounds: SweepBounds, prefix: string) {
  const page = body.pageToken ? Number(body.pageToken) : 0
  const ids = Array.from({ length: 20 }, (_, index) => place(`${prefix}-${boundsKey(bounds)}-${page}-${index}`))
  return { places: ids, ...(page < 2 ? { nextPageToken: String(page + 1) } : {}) }
}

describe('splitCell', () => {
  it('divide en 4 mientras los lados admiten mitades del mínimo y devuelve vacío en la celda mínima', () => {
    expect(splitCell(root)).toHaveLength(4)
    expect(splitCell(root, 1_000_000)).toEqual([])
    const children = splitCell(root)
    expect(children.every((child) => child.south >= root.south && child.north <= root.north)).toBe(true)
  })
})

describe('GoogleNeighborhoodSweeper', () => {
  it('pagina hasta tres páginas por consulta y envía los filtros estrictos', async () => {
    const { sweeper, calls } = setup((body) => {
      if (body.textQuery !== 'restaurante') return {}
      const page = body.pageToken ? Number(body.pageToken) : 0
      const size = page === 2 ? 15 : 20
      return {
        places: Array.from({ length: size }, (_, index) => place(`r-${page}-${index}`)),
        ...(page < 2 ? { nextPageToken: String(page + 1) } : {}),
      }
    }, { subdivideThreshold: 60 })

    const { places, summary } = await sweeper.sweep(NEIGHBORHOOD)

    const restaurantCalls = calls.filter((call) => call.textQuery === 'restaurante')
    expect(restaurantCalls.map((call) => call.pageToken)).toEqual([undefined, '1', '2'])
    expect(restaurantCalls[0]).toMatchObject({ includedType: 'restaurant', strictTypeFiltering: true, pageSize: 20 })
    expect(places).toHaveLength(55)
    expect(summary.newByQuery['restaurant:restaurante']).toBe(55)
    expect(summary.newByQuery['bar:tragos']).toBe(0)
    expect(summary.apiCalls).toEqual({ sweep: 3 + totalQueries - 1, rescue: 0 })
    expect(summary.saturatedCells).toEqual([])
    expect(summary.truncated).toBe(false)
    expect(summary.failedCallCount).toBe(0)
    expect(summary.failedPageCount).toBe(0)
  })

  it('subdivide desde 40 resultados por defecto y no con 39', async () => {
    const rootKey = boundsKey(root)
    const respond = (count: number) => (body: SearchBody, bounds: SweepBounds) => {
      if (body.textQuery !== 'heladería' || boundsKey(bounds) !== rootKey) return {}
      const page = body.pageToken ? 1 : 0
      const size = page === 0 ? 20 : count - 20
      return {
        places: Array.from({ length: size }, (_, index) => place(`h-${page}-${index}`)),
        ...(page === 0 ? { nextPageToken: 'p2' } : {}),
      }
    }

    const at40 = setup(respond(40))
    await at40.sweeper.sweep(NEIGHBORHOOD)
    const below = setup(respond(39))
    await below.sweeper.sweep(NEIGHBORHOOD)

    expect(at40.calls.filter((call) => call.textQuery === 'heladería').length).toBeGreaterThan(2)
    expect(below.calls.filter((call) => call.textQuery === 'heladería')).toHaveLength(2)
  })

  it('reintenta una página intermedia tras 2 s y cuenta la falla si persiste', async () => {
    let recovered = false
    const flaky = setup((body) => {
      if (body.textQuery !== 'heladería') return {}
      if (!body.pageToken) return { places: [place('h1')], nextPageToken: 'p2' }
      if (!recovered) return new Response('{}', { status: 503 })
      return { places: [place('h2')] }
    })
    flaky.sleep.mockImplementation(async (ms: number) => {
      if (ms === 2000) recovered = true
    })
    const ok = await flaky.sweeper.sweep(NEIGHBORHOOD)
    expect(flaky.sleep).toHaveBeenCalledWith(2000)
    expect(ok.places.map((item) => item.placeId).sort()).toEqual(['h1', 'h2'])
    expect(ok.summary.failedCallCount).toBe(0)

    const broken = setup((body) => {
      if (body.textQuery !== 'heladería') return {}
      if (!body.pageToken) return { places: [place('h1')], nextPageToken: 'p2' }
      return new Response('{}', { status: 503 })
    })
    const failed = await broken.sweeper.sweep(NEIGHBORHOOD)
    expect(broken.calls.filter((call) => call.pageToken === 'p2')).toHaveLength(8)
    expect(failed.summary.failedCalls).toEqual([expect.objectContaining({ key: 'ice_cream_shop:heladería', page: 2 })])
    expect(failed.summary.failedCallCount).toBe(1)
    expect(failed.summary.failedPageCount).toBe(1)
  })

  it('subdivide sólo la consulta saturada y saltea celdas fuera del polígono', async () => {
    const rootKey = boundsKey(root)
    const { sweeper, calls } = setup((body, bounds) =>
      body.textQuery === 'tragos' && boundsKey(bounds) === rootKey ? saturatedPages(body, bounds, 'tragos') : {},
    )

    const { summary } = await sweeper.sweep(NEIGHBORHOOD)

    const children = splitCell(root)
    const cellPolygon = (cell: SweepBounds) => turfPolygon([[[cell.west, cell.south], [cell.east, cell.south], [cell.east, cell.north], [cell.west, cell.north], [cell.west, cell.south]]])
    const intersecting = children.filter((child) => booleanIntersects(cellPolygon(child), feature))
    const tragos = calls.filter((call) => call.textQuery === 'tragos')
    expect(tragos).toHaveLength(3 + intersecting.length)
    expect(calls.filter((call) => call.textQuery === 'heladería')).toHaveLength(1)
    expect(calls.every((call) => booleanIntersects(cellPolygon(boundsOf(call)), feature))).toBe(true)
    expect(summary.newByQuery['bar:tragos']).toBe(60)
  })

  it('corre el rescate una vez por celda mínima saturada y registra su aporte', async () => {
    const { sweeper, calls } = setup((body, bounds) => {
      if (body.textQuery === 'bar' || body.textQuery === 'tragos') return saturatedPages(body, bounds, body.textQuery)
      if (body.textQuery === 'sushi') return { places: [place('sushi-1'), place('bar-' + boundsKey(bounds) + '-0-0')] }
      return {}
    }, { minCellMeters: 1_000_000 })

    const { summary, places } = await sweeper.sweep(NEIGHBORHOOD)

    expect(summary.saturatedCells).toHaveLength(1)
    expect(summary.saturatedCells[0].saturatedBy).toEqual([
      { googleType: 'bar', query: 'bar' },
      { googleType: 'bar', query: 'tragos' },
    ])
    expect(summary.saturatedCells[0].rescueNewPlaces).toBe(1)
    expect(summary.apiCalls.rescue).toBe(RESCUE_QUERIES.length)
    expect(calls.filter((call) => call.textQuery === 'sushi')).toEqual([expect.objectContaining({ includedType: 'restaurant' })])
    expect(summary.newByQuery['rescate:sushi']).toBe(1)
    expect(places.find((item) => item.placeId === 'sushi-1')).toMatchObject({ seedCategories: ['restaurant'], foundBy: ['rescate:sushi'] })
  })

  it('descarta lugares fuera del polígono y acumula categorías y consultas de duplicados', async () => {
    const { sweeper } = setup((body) => {
      if (body.textQuery === 'bar') return { places: [place('shared', inside, ['bar']), place('far', outside)] }
      if (body.textQuery === 'vinoteca') return { places: [place('shared', inside, ['bar', 'wine_bar']), place('far', outside)] }
      return {}
    })
    const events: NeighborhoodSweepEvent[] = []

    const { places, summary } = await sweeper.sweep(NEIGHBORHOOD, { onEvent: (event) => events.push(event) })

    expect(places).toHaveLength(2)
    expect(places.find((item) => item.placeId === 'shared')).toMatchObject({
      seedCategories: ['bar', 'wine_bar'],
      foundBy: ['bar:bar', 'wine_bar:vinoteca'],
      insideNeighborhood: true,
    })
    expect(places.find((item) => item.placeId === 'far')).toMatchObject({ insideNeighborhood: false })
    expect(summary.totalPlaces).toBe(1)
    expect(summary.discardedOutside).toBe(1)
    expect(summary.newByQuery['bar:bar']).toBe(1)
    expect(summary.bySeedCategory).toEqual({ bar: 1, wine_bar: 1 })
    expect(summary.newByQuery['wine_bar:vinoteca']).toBe(0)
    const placeEvents = events.filter((event) => event.type === 'places')
    expect(placeEvents.at(-1)).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ placeId: 'shared', seedCategories: ['bar', 'wine_bar'] })]),
    })
  })

  it('reintenta 429 con backoff, registra fallas definitivas y sigue', async () => {
    let restaurantAttempts = 0
    const { sweeper, calls, sleep } = setup((body) => {
      if (body.textQuery === 'restaurante') {
        restaurantAttempts += 1
        return restaurantAttempts === 1 ? new Response('{}', { status: 429 }) : { places: [place('ok')] }
      }
      if (body.textQuery === 'café') return new Response('{}', { status: 500 })
      return {}
    })

    const { places, summary } = await sweeper.sweep(NEIGHBORHOOD)

    expect(places.map((item) => item.placeId)).toEqual(['ok'])
    expect(calls.filter((call) => call.textQuery === 'café')).toHaveLength(4)
    expect(summary.failedCalls).toEqual([expect.objectContaining({ key: 'cafe:café', page: 1, message: 'Google Places respondió 500.' })])
    expect(summary.failedCallCount).toBe(1)
    expect(summary.failedPageCount).toBe(0)
    expect(sleep).not.toHaveBeenCalledWith(2000)
    expect(calls.some((call) => call.textQuery === 'pizzería')).toBe(true)
    expect(sleep).toHaveBeenCalledWith(600)
    expect(summary.apiCalls.sweep).toBe(totalQueries + 1 + 3)
  })

  it('en modo sólo IDs pide el field mask gratuito y no filtra por polígono', async () => {
    const { sweeper, fetcher } = setup((body) => {
      if (body.textQuery === 'bar') return { places: [{ id: 'a' }, { id: 'b' }] }
      if (body.textQuery === 'vinoteca') return { places: [{ id: 'a' }] }
      return {}
    })

    const { places, summary } = await sweeper.sweep(NEIGHBORHOOD, { mode: 'ids' })

    const masks = new Set(fetcher.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-Goog-FieldMask')))
    expect([...masks]).toEqual(['places.id,nextPageToken'])
    expect(summary.mode).toBe('ids')
    expect(summary.byGroup).toBeNull()
    expect(places.every((item) => item.group === null && item.reason === null)).toBe(true)
    expect(summary.discardedOutside).toBe(0)
    expect(places).toHaveLength(2)
    expect(places.find((item) => item.placeId === 'a')).toMatchObject({
      name: 'a',
      insideNeighborhood: null,
      seedCategories: ['bar', 'wine_bar'],
      foundBy: ['bar:bar', 'wine_bar:vinoteca'],
      googleMapsUri: 'https://www.google.com/maps/search/?api=1&query_place_id=a',
    })
  })

  it('clasifica en accepted, review y rejected, cuenta motivos y no usa el rating', async () => {
    const withMeta = (id: string, meta: Record<string, unknown>) => ({ ...place(id), ...meta })
    const { sweeper, fetcher } = setup((body) => {
      if (body.textQuery !== 'restaurante') return {}
      return {
        places: [
          withMeta('ok', { primaryType: 'restaurant', businessStatus: 'OPERATIONAL', rating: 1.2, userRatingCount: 10 }),
          withMeta('few', { primaryType: 'restaurant', rating: 5, userRatingCount: 3 }),
          withMeta('sushi', { primaryType: 'sushi_restaurant', rating: 4.9, userRatingCount: 800 }),
          withMeta('closed', { primaryType: 'restaurant', businessStatus: 'CLOSED_PERMANENTLY' }),
          withMeta('market', { primaryType: 'supermarket' }),
          withMeta('shop', { primaryType: 'clothing_store' }),
          withMeta('nodata', {}),
          { ...withMeta('far', { primaryType: 'supermarket' }), location: outside },
        ],
      }
    })

    const { places, summary } = await sweeper.sweep(NEIGHBORHOOD)
    const byId = Object.fromEntries(places.map((item) => [item.placeId, item]))

    expect(byId.ok).toMatchObject({ group: 'accepted', reason: null, primaryType: 'restaurant', rating: 1.2, userRatingCount: 10 })
    expect(byId.few).toMatchObject({ group: 'review', reason: 'few_reviews', rating: 5, userRatingCount: 3 })
    expect(byId.sushi).toMatchObject({ group: 'accepted', rating: 4.9, userRatingCount: 800 })
    expect(byId.closed).toMatchObject({ group: 'rejected', reason: 'closed_permanently' })
    expect(byId.market).toMatchObject({ group: 'rejected', reason: 'excluded_type:supermarket' })
    expect(byId.shop).toMatchObject({ group: 'review', reason: 'unknown_type:clothing_store' })
    expect(byId.nodata).toMatchObject({ group: 'review', reason: 'primary_type_missing', rating: null, userRatingCount: null })
    expect(summary.byGroup).toEqual({ accepted: 2, review: 3, rejected: 2 })
    expect(summary.byReason).toEqual({
      few_reviews: 1,
      closed_permanently: 1,
      'excluded_type:supermarket': 1,
      'unknown_type:clothing_store': 1,
      primary_type_missing: 1,
    })
    expect(summary.unknownTypes).toEqual({ clothing_store: 1 })
    expect(summary.totalPlaces).toBe(7)

    const mask = new Headers(fetcher.mock.calls[0][1]?.headers).get('X-Goog-FieldMask')
    for (const field of ['places.businessStatus', 'places.primaryType', 'places.rating', 'places.userRatingCount']) {
      expect(mask).toContain(field)
    }
  })

  it('corta al llegar al tope de llamadas', async () => {
    const { sweeper, calls } = setup(() => ({}), { maxCalls: 5 })
    const { summary } = await sweeper.sweep(NEIGHBORHOOD)
    expect(calls).toHaveLength(5)
    expect(summary.truncated).toBe(true)
    expect(summary.apiCalls.sweep).toBe(5)
  })

  it('se detiene cuando se cancela', async () => {
    const controller = new AbortController()
    const { sweeper, calls } = setup(() => {
      controller.abort()
      return {}
    })
    await sweeper.sweep(NEIGHBORHOOD, { signal: controller.signal })
    expect(calls).toHaveLength(1)
  })

  it('aborta ante credenciales rechazadas y valida el barrio', async () => {
    const { sweeper } = setup(() => new Response('{}', { status: 403 }))
    await expect(sweeper.sweep(NEIGHBORHOOD)).rejects.toMatchObject({ kind: 'authorization' })
    await expect(sweeper.sweep('OTRA CIUDAD')).rejects.toMatchObject({ kind: 'validation' })
  })
})

describe('catálogo de barrios', () => {
  it('tiene nombre visible para cada polígono', () => {
    expect([...NEIGHBORHOOD_IDS].sort()).toEqual(Object.keys(NEIGHBORHOOD_NAMES).sort())
  })
})
