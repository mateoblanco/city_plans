import { describe, expect, it, vi } from 'vitest'
import type { Query } from '@shared/events.ts'
import { staleCoordinatesQuery } from '@shared/google-flags.ts'
import { BATCH_SIZE, runCoordinateRefresh, selectCandidatesQuery } from '../run'

const NOW = new Date('2026-11-24T07:00:00.000Z')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const silent = { log: vi.fn(), error: vi.fn() }

type Row = Record<string, unknown>
const place = (n: number, lat = -34.9, lng = -56.16): Row => ({ id: `p${n}`, google_place_id: `g${n}`, lat, lng })

/** Base falsa: responde según el SQL y anota cada consulta. `opened` dice si el upsert de un aviso devuelve fila. */
function fakeDb(candidates: Row[], options: { stale?: number; opened?: boolean } = {}) {
  const queries: Query[] = []
  const run = vi.fn(async (query: Query) => {
    queries.push(query)
    if (query.text.startsWith('select id::text')) return candidates
    if (query.text.startsWith('select count')) return [{ stale: options.stale ?? 0 }]
    if (query.text.startsWith('insert into place_google_flags')) return options.opened === false ? [] : [{ id: 'f1' }]
    return []
  })
  const of = (prefix: string) => queries.filter((query) => query.text.startsWith(prefix))
  return { run, queries, of }
}

const at = (point: { lat: number; lng: number }, extra: Row = {}) => json({ location: { latitude: point.lat, longitude: point.lng }, ...extra })

describe('selección de la tanda', () => {
  it('publicados con coordenadas de Google de más de 25 días (o sin fecha), los más viejos primero, de a 40', () => {
    const query = selectCandidatesQuery(NOW, BATCH_SIZE)
    expect(BATCH_SIZE).toBe(40)
    expect(query.text).toContain("status = 'published'")
    expect(query.text).toContain('google_place_id is not null')
    expect(query.text).toContain("coordinates_source = 'google'")
    expect(query.text).toContain('coordinates_fetched_at is null or coordinates_fetched_at < $1')
    expect(query.text).toContain('order by coordinates_fetched_at asc nulls first')
    expect(query.params).toEqual(['2026-10-30T07:00:00.000Z', 40])
  })

  it('el control de atrasados cuenta los de más de 30 días', () => {
    expect(staleCoordinatesQuery(NOW).params).toEqual(['2026-10-25T07:00:00.000Z'])
  })

  it('la corrida pide la tanda con el tamaño indicado', async () => {
    const db = fakeDb([])
    await runCoordinateRefresh({ run: db.run, fetchFn: vi.fn(), apiKey: 'k', now: () => NOW, batchSize: 5, log: silent })
    expect(db.of('select id::text')[0].params[1]).toBe(5)
  })
})

describe('runCoordinateRefresh', () => {
  it('refresca location y coordinates_fetched_at y registra la corrida', async () => {
    const db = fakeDb([place(1), place(2)], { stale: 3 })
    const fetchFn = vi.fn(async () => at({ lat: -34.9, lng: -56.16 }))
    const summary = await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: 'k', now: () => NOW, log: silent })

    expect(summary).toEqual({ batchSize: 40, selected: 2, refreshed: 2, flagged: 0, failed: 0, stoppedReason: null, staleAfter: 3 })
    const updates = db.of('update places')
    expect(updates).toHaveLength(2)
    expect(updates[0].text).toContain('coordinates_fetched_at = $4')
    expect(updates[0].text).not.toContain('updated_at')
    expect(updates[0].params).toEqual(['p1', -34.9, -56.16, NOW.toISOString()])
    expect(db.of('insert into place_google_flags')).toHaveLength(0)
    expect(db.of('insert into google_refresh_runs')[0].params).toEqual([NOW.toISOString(), NOW.toISOString(), 40, 2, 0, 0, null, 3])
  })

  it('se movió más de 100 m: actualiza igual y abre el aviso', async () => {
    const db = fakeDb([place(1)])
    const fetchFn = vi.fn(async () => at({ lat: -34.9 + 150 / 111195, lng: -56.16 }))
    const summary = await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: 'k', now: () => NOW, log: silent })

    expect(summary).toMatchObject({ refreshed: 1, flagged: 1 })
    expect(db.of('update places')).toHaveLength(1)
    const [flag] = db.of('insert into place_google_flags')
    expect(flag.params).toEqual(['p1', 'moved', NOW.toISOString(), 150, null])
  })

  it('un aviso que ya estaba abierto o ignorado no cuenta como marcado', async () => {
    const db = fakeDb([place(1)], { opened: false })
    const fetchFn = vi.fn(async () => at({ lat: -34.9 + 150 / 111195, lng: -56.16 }))
    expect(await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: 'k', now: () => NOW, log: silent })).toMatchObject({ flagged: 0 })
  })

  it('place_id inválido: marca "no encontrado" y no actualiza la fecha', async () => {
    const db = fakeDb([place(1)])
    const fetchFn = vi.fn(async () => json({ error: { status: 'NOT_FOUND', message: 'not found' } }, 404))
    const summary = await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: 'k', now: () => NOW, log: silent })

    expect(summary).toMatchObject({ refreshed: 0, flagged: 1, failed: 0 })
    expect(db.of('update places')).toHaveLength(0)
    expect(db.of('insert into place_google_flags')[0].params.slice(0, 2)).toEqual(['p1', 'not_found'])
  })

  it('movedPlaceId: refresca y marca "reemplazado" con el id nuevo', async () => {
    const db = fakeDb([place(1)])
    const fetchFn = vi.fn(async () => at({ lat: -34.9, lng: -56.16 }, { movedPlaceId: 'gNuevo' }))
    await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: 'k', now: () => NOW, log: silent })
    expect(db.of('insert into place_google_flags')[0].params).toEqual(['p1', 'replaced', NOW.toISOString(), null, 'gNuevo'])
  })

  it.each([
    [403, 'PERMISSION_DENIED', 'authorization'],
    [429, 'RESOURCE_EXHAUSTED', 'quota'],
  ])('un %i corta la corrida sin reintentar y lo deja registrado', async (status, code, reason) => {
    const db = fakeDb([place(1), place(2), place(3)])
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(at({ lat: -34.9, lng: -56.16 }))
      .mockResolvedValue(json({ error: { status: code, message: 'no' } }, status))
    const log = { log: vi.fn(), error: vi.fn() }
    const summary = await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: 'k', now: () => NOW, log })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(summary).toMatchObject({ selected: 3, refreshed: 1, failed: 0, stoppedReason: reason })
    expect(db.of('insert into google_refresh_runs')[0].params[6]).toBe(reason)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Corrida cortada'))
  })

  it('una falla suelta (5xx) cuenta como fallida, no toca el lugar y sigue con el resto', async () => {
    const db = fakeDb([place(1), place(2)])
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValueOnce(at({ lat: -34.9, lng: -56.16 }))
    const summary = await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: 'k', now: () => NOW, log: silent })
    expect(summary).toMatchObject({ refreshed: 1, failed: 1, stoppedReason: null })
    expect(db.of('update places')[0].params[0]).toBe('p2')
  })

  it('sin GOOGLE_PLACES_API_KEY no llama a Google y registra la corrida cortada', async () => {
    const db = fakeDb([place(1)])
    const fetchFn = vi.fn()
    const summary = await runCoordinateRefresh({ run: db.run, fetchFn, apiKey: ' ', now: () => NOW, log: silent })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(db.of('select id::text')).toHaveLength(0)
    expect(summary.stoppedReason).toBe('missing_key')
    expect(db.of('insert into google_refresh_runs')).toHaveLength(1)
  })
})
