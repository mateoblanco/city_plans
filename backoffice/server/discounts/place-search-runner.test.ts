import { describe, expect, it, vi } from 'vitest'
import type { DiscountPlace, ProviderPlaceLocation, StoredBenefit } from '../../src/types/discounts.ts'
import type { PlaceEnrichmentResponse } from '../../src/types/places.ts'
import type { ExtractionReport } from '../providers/extraction-report.ts'
import { ExaProviderFailure, InstagramProviderFailure, PlacesProviderError, type FoundPlace } from '../providers/places-provider.ts'
import { memoryDiscountStore } from './memory-store.ts'
import { missingRows } from './missing.ts'
import { planDiscountWrites, type OurPlace } from './persist.ts'
import { DiscountPlaceSearchRunner, STOPPED_BY_APIFY, type PlaceSearchDependencies } from './place-search-runner.ts'
import type { ReadPlace } from './reader.ts'

const POCITOS = { lat: -34.9115, lng: -56.153 }
const CENTRO = { lat: -34.9055, lng: -56.1915 }
const near = (at: { lat: number; lng: number }, meters: number) => ({ lat: at.lat + meters / 111_320, lng: at.lng })

const benefit: StoredBenefit = {
  id: 'b', percent: 20, cardType: 'debit', cardTiers: [], cardProgram: null, days: 'all', daysText: null, mode: 'instant', instantPercent: null, refundPercent: null,
  cap: null, validFrom: null, validTo: null, conditions: null, sourceText: '20%', sourceUrl: null, parsedBy: 'html',
  firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-01T00:00:00.000Z', active: true, expired: false,
}
const location = (patch: Partial<ProviderPlaceLocation>): ProviderPlaceLocation => ({ address: 'Av. Brasil 2580', area: null, department: null, mapsUrl: null, ...patch })

function place(id: string, sourceName: string, patch: Partial<DiscountPlace> = {}): DiscountPlace {
  return {
    id, providerId: id.split(':')[0], sourceName, category: null, city: null, departments: ['Montevideo'], montevideo: true, locations: [],
    website: null, instagram: null, sourceUrl: `https://bank.test/${id}`, logoUrl: null, description: null, sourceTags: [],
    campaign: { validFrom: null, validTo: null, text: null }, benefits: [{ ...benefit, id: `${id}:b` }],
    match: { status: 'missing', origin: 'auto', links: [], candidates: [], missingBranches: 0, nearby: [] },
    firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-01T00:00:00.000Z', active: true, ignored: false, matchedAt: null, ...patch,
  }
}

const found = (placeId: string, name: string, at: { lat: number; lng: number }, primaryType = 'restaurant'): FoundPlace => ({ placeId, name, address: `${name}, Montevideo`, lat: at.lat, lng: at.lng, primaryType })

const review = { unmappedFacts: [], doubts: [], anomalies: [], hoursRetry: { attempted: false, recovered: false, costUsd: 0 }, logo: { status: 'missing', reason: 'no_instagram', kind: null } }
function extracted(googlePlaceId: string, reviewReasons: string[] = []): PlaceEnrichmentResponse {
  return {
    source: 'llm', status: 'ok', model: 'test', review, sourceAudit: {},
    performance: { totalMs: 1000, costUsd: { totalUsd: 0.07, providers: { llm: { costUsd: 0.03 } } } },
    place: { name: 'La Pasiva', googlePlaceId, reviewReasons, hours: { status: 'none' }, contact: { instagram: null, website: null }, tags: [] },
  } as unknown as PlaceEnrichmentResponse
}

const ourUuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Un store en memoria con estos lugares del proveedor y un runner con Google, extracción y guardado de mentira. */
function setup(seed: DiscountPlace[], options: { google?: Record<string, FoundPlace[] | Error>; ours?: OurPlace[]; extract?: (id: string) => Promise<PlaceEnrichmentResponse>; withReport?: boolean } = {}) {
  const store = memoryDiscountStore([], { seed, ours: options.ours })
  const findPlace = vi.fn(async ({ query }: { query: string }) => {
    const name = query.split(',')[0]
    const result = options.google?.[name] ?? []
    if (result instanceof Error) throw result
    return result
  })
  const extract = vi.fn(options.extract ?? (async (id: string) => extracted(id)))
  let saved = 0
  const save = vi.fn(async (results: unknown[]) => results.map((result) => ({ googlePlaceId: (result as PlaceEnrichmentResponse & { status: 'ok' }).place.googlePlaceId, id: ourUuid(++saved), action: 'created' as const, embedded: true })))
  const reports: ExtractionReport[] = []
  const deps: PlaceSearchDependencies = {
    store,
    finder: { findPlace },
    details: { getDetails: vi.fn(async () => ({ data: { primaryType: 'cafe' } }) as never) },
    extractor: { extract },
    saver: { save },
    ...(options.withReport ? { reportWriter: async (report) => { reports.push(report); return 'output/report.json' } } : {}),
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  }
  const runner = new DiscountPlaceSearchRunner(deps)
  const keyOf = async (name: string, neighborhood?: string) => missingRows(await store.list()).find((row) => row.name === name && (!neighborhood || row.neighborhoodId === neighborhood))!.key
  const searches = () => store.placeSearches()
  return { store, runner, findPlace, extract, save, reports, keyOf, searches }
}

const pasivaPocitos = () => place('santander:la-pasiva', 'La Pasiva', { locations: [location({ coordinates: POCITOS })] })

describe('DiscountPlaceSearchRunner', () => {
  it('resultado claro: lo extrae con la categoría y el barrio de Google, lo guarda con from_discounts (a revisión) y guarda sólo place_id y coordenadas', async () => {
    const ctx = setup([pasivaPocitos(), place('bbva:la-pasiva', 'La Pasiva', { locations: [location({ area: 'Pocitos' })] })], {
      google: { 'La Pasiva': [found('g-pasiva', 'La Pasiva', near(POCITOS, 40), 'cafe')] },
      extract: async (id) => extracted(id, ['low_rating']),
    })
    await ctx.runner.start([await ctx.keyOf('La Pasiva')])
    await ctx.runner.settled()

    expect(ctx.findPlace).toHaveBeenCalledTimes(1)
    expect(ctx.findPlace).toHaveBeenCalledWith({ query: 'La Pasiva, Av. Brasil 2580, Montevideo', near: POCITOS })
    expect(ctx.extract).toHaveBeenCalledWith('g-pasiva', { seedCategories: ['cafe'], neighborhoodId: 'POCITOS' })
    const [[saved]] = ctx.save.mock.calls as unknown as [[PlaceEnrichmentResponse & { status: 'ok' }][]]
    expect(saved[0].place.reviewReasons).toEqual(['low_rating', 'from_discounts'])

    const searches = await ctx.searches()
    // La misma búsqueda en los dos proveedores de la fila.
    for (const id of ['santander:la-pasiva', 'bbva:la-pasiva']) {
      expect(searches[id]).toEqual([{
        locationIndex: 0, status: 'review', searchedAt: '2026-11-10T12:00:00.000Z', googlePlaceId: 'g-pasiva', location: near(POCITOS, 40),
        candidates: [], placeId: ourUuid(1), error: null, ourPlace: null,
      }])
      // Nada de nombre ni dirección de Google en lo guardado.
      expect(JSON.stringify(searches[id])).not.toContain('Montevideo')
    }

    const status = ctx.runner.status()
    expect(status.status).toBe('done')
    if (status.status !== 'done') return
    expect(status.rows).toEqual([expect.objectContaining({ name: 'La Pasiva', state: 'done', outcome: 'review', providerIds: ['bbva', 'santander'] })])
    expect(status.searches).toBe(1)
    expect(status.costUsd).toBeCloseTo(0.032 + 0.07)
  })

  it('ya existe en la base (por place_id): no se extrae y queda con nuestro lugar', async () => {
    const ctx = setup([pasivaPocitos()], {
      google: { 'La Pasiva': [found('g-pasiva', 'La Pasiva', POCITOS)] },
      ours: [{ id: ourUuid(9), googlePlaceId: 'g-pasiva', name: 'La Pasiva', status: 'hidden' }],
    })
    await ctx.runner.start([await ctx.keyOf('La Pasiva')])
    await ctx.runner.settled()
    expect(ctx.extract).not.toHaveBeenCalled()
    expect((await ctx.searches())['santander:la-pasiva']).toEqual([expect.objectContaining({ status: 'exists', placeId: ourUuid(9), ourPlace: { id: ourUuid(9), name: 'La Pasiva', status: 'hidden' } })])
  })

  it('dudoso: guarda hasta 3 candidatos (place_id y coordenadas), nombre y dirección sólo en memoria; elegir uno lo extrae, "Ninguno" lo deja no encontrado', async () => {
    const ctx = setup([pasivaPocitos(), place('santander:kamba', 'Kamba', { locations: [location({ coordinates: CENTRO })] })], {
      google: {
        'La Pasiva': [found('g-1', 'La Pasiva', near(POCITOS, 30)), found('g-2', 'La Pasiva', near(POCITOS, 90))],
        Kamba: [found('k-1', 'Kamba', near(CENTRO, 400)), found('k-2', 'Kamba Sushi', near(CENTRO, 900))],
      },
    })
    const pasiva = await ctx.keyOf('La Pasiva')
    const kamba = await ctx.keyOf('Kamba')
    await ctx.runner.start([pasiva, kamba])
    await ctx.runner.settled()
    expect(ctx.extract).not.toHaveBeenCalled()
    const saved = await ctx.searches()
    expect(saved['santander:la-pasiva'][0]).toMatchObject({ status: 'doubtful', candidates: [{ placeId: 'g-1', ...near(POCITOS, 30) }, { placeId: 'g-2', ...near(POCITOS, 90) }] })
    const status = ctx.runner.status()
    if (status.status === 'idle') throw new Error('sin trabajo')
    expect(status.candidateDetails['g-1']).toEqual({ name: 'La Pasiva', address: 'La Pasiva, Montevideo' })
    expect(status.rows.find((row) => row.rowKey === pasiva)?.candidateMeters).toEqual({ 'g-1': 30, 'g-2': 90 })

    // Un place_id que no es candidato no se acepta.
    expect(await ctx.runner.pick(pasiva, 'otro')).toBe('not_candidate')
    expect(await ctx.runner.pick(pasiva, 'g-2')).toBe('ok')
    await ctx.runner.settled()
    expect(ctx.findPlace).toHaveBeenCalledTimes(2)
    expect(ctx.extract).toHaveBeenCalledWith('g-2', { seedCategories: ['restaurant'], neighborhoodId: 'POCITOS' })
    expect((await ctx.searches())['santander:la-pasiva'][0]).toMatchObject({ status: 'review', googlePlaceId: 'g-2' })

    expect(await ctx.runner.pick(kamba, null)).toBe('ok')
    expect((await ctx.searches())['santander:kamba'][0]).toMatchObject({ status: 'not_found', candidates: [] })
    // Ya no está dudoso.
    expect(await ctx.runner.pick(kamba, 'k-1')).toBe('not_doubtful')
    expect(ctx.runner.status()).toMatchObject({ status: 'done', rows: expect.arrayContaining([expect.objectContaining({ rowKey: kamba, outcome: 'not_found' })]) })
  })

  it('elegir sin tipo de Google en memoria usa el de Place Details (el mismo que pide la extracción)', async () => {
    const ctx = setup([pasivaPocitos()])
    await ctx.store.setPlaceSearches([{ discountPlaceId: 'santander:la-pasiva', search: { locationIndex: 0, status: 'doubtful', searchedAt: '2026-11-09T00:00:00.000Z', googlePlaceId: null, location: null, candidates: [{ placeId: 'g-1', ...POCITOS }], placeId: null, error: null } }])
    expect(await ctx.runner.pick(await ctx.keyOf('La Pasiva'), 'g-1')).toBe('ok')
    await ctx.runner.settled()
    expect(ctx.extract).toHaveBeenCalledWith('g-1', { seedCategories: ['cafe'], neighborhoodId: 'POCITOS' })
  })

  it('no encontrado, errores parciales y sin fuentes: uno que falla no corta a los demás', async () => {
    const ctx = setup([
      pasivaPocitos(),
      place('itau:montevideo:nada', 'Nada'),
      place('itau:montevideo:roto', 'Roto'),
      place('itau:montevideo:vacio', 'Vacio'),
      place('itau:montevideo:kamba', 'Kamba'),
    ], {
      google: {
        'La Pasiva': [found('g-pasiva', 'La Pasiva', POCITOS)],
        Roto: new PlacesProviderError('quota', 'Google Places rechazó por cuota.'),
        Vacio: [found('g-vacio', 'Vacio', CENTRO)],
        Kamba: [found('g-kamba', 'Kamba', CENTRO)],
      },
      extract: async (id) => {
        if (id === 'g-kamba') throw new Error('Falló el modelo.')
        if (id === 'g-vacio') return { ...extracted(id), status: 'no_sources', target: {} } as unknown as PlaceEnrichmentResponse
        return extracted(id)
      },
    })
    const keys = await Promise.all(['La Pasiva', 'Nada', 'Roto', 'Vacio', 'Kamba'].map((name) => ctx.keyOf(name)))
    await ctx.runner.start(keys)
    await ctx.runner.settled()
    const searches = await ctx.searches()
    expect(searches['santander:la-pasiva'][0].status).toBe('review')
    expect(searches['itau:montevideo:nada'][0]).toMatchObject({ locationIndex: null, status: 'not_found' })
    expect(searches['itau:montevideo:roto'][0]).toMatchObject({ status: 'error', error: 'Google Places rechazó por cuota.' })
    expect(searches['itau:montevideo:vacio'][0]).toMatchObject({ status: 'error', error: 'Las fuentes no trajeron datos del lugar: no se guardó.' })
    expect(searches['itau:montevideo:kamba'][0]).toMatchObject({ status: 'error', error: 'Falló el modelo.' })
    expect(ctx.save).toHaveBeenCalledTimes(1)
  })

  it('corta con errores seguidos de Apify: los que quedaban no se procesan y quedan con error para reintentar', async () => {
    const names = ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco']
    const ctx = setup(names.map((name) => place(`itau:montevideo:${name.toLowerCase()}`, name)), {
      google: Object.fromEntries(names.map((name, index) => [name, [found(`g-${index}`, name, CENTRO)]])),
      extract: async () => {
        throw new InstagramProviderFailure('Apify no respondió.')
      },
    })
    // De a uno, para que el orden de los errores sea el de la cola.
    const runner = new DiscountPlaceSearchRunner({ ...(ctx.runner as unknown as { deps: PlaceSearchDependencies }).deps, concurrency: 1 })
    await runner.start(await Promise.all(names.map((name) => ctx.keyOf(name))))
    await runner.settled()
    expect(ctx.extract).toHaveBeenCalledTimes(3)
    const searches = await ctx.searches()
    expect(searches['itau:montevideo:cuatro'][0]).toMatchObject({ status: 'error', error: STOPPED_BY_APIFY })
    expect(runner.status()).toMatchObject({ status: 'done', stopped: STOPPED_BY_APIFY })
  })

  it('un error de Exa en el medio no corta si el siguiente sale bien', async () => {
    const names = ['Uno', 'Dos', 'Tres']
    let calls = 0
    const ctx = setup(names.map((name) => place(`itau:montevideo:${name.toLowerCase()}`, name)), {
      google: Object.fromEntries(names.map((name, index) => [name, [found(`g-${index}`, name, CENTRO)]])),
      extract: async (id) => {
        calls += 1
        if (calls <= 2) throw new ExaProviderFailure('Exa no respondió.')
        return extracted(id)
      },
    })
    await ctx.runner.start(await Promise.all(names.map((name) => ctx.keyOf(name))))
    await ctx.runner.settled()
    expect(ctx.extract).toHaveBeenCalledTimes(3)
    expect(ctx.runner.status()).toMatchObject({ stopped: null })
  })

  it('una sola búsqueda a la vez; filas que ya no están, rechazadas', async () => {
    const ctx = setup([pasivaPocitos()], { google: { 'La Pasiva': [found('g', 'La Pasiva', POCITOS)] } })
    expect(await ctx.runner.start(['santander:no-existe#0'])).toEqual({ unknown: ['santander:no-existe#0'] })
    const key = await ctx.keyOf('La Pasiva')
    expect(await ctx.runner.start([key])).toHaveProperty('jobId')
    expect(await ctx.runner.start([key])).toEqual({ busy: true })
    await ctx.runner.settled()
    expect(await ctx.runner.start([key])).toHaveProperty('jobId')
    await ctx.runner.settled()
  })

  it('escribe el reporte del lote con las extracciones (para el costo promedio)', async () => {
    const ctx = setup([pasivaPocitos()], { google: { 'La Pasiva': [found('g', 'La Pasiva', POCITOS)] }, withReport: true })
    await ctx.runner.start([await ctx.keyOf('La Pasiva')])
    await ctx.runner.settled()
    expect(ctx.reports).toHaveLength(1)
    expect(ctx.reports[0].summary).toMatchObject({ placesProcessed: 1, totalCostUsd: 0.07 })
  })

  it('una corrida de descuentos no pisa las búsquedas guardadas', async () => {
    const ctx = setup([pasivaPocitos()], { google: { 'La Pasiva': [found('g', 'La Pasiva', POCITOS)] } })
    await ctx.runner.start([await ctx.keyOf('La Pasiva')])
    await ctx.runner.settled()
    const { benefits: _benefits, match: _match, firstSeenAt: _first, lastSeenAt: _last, active: _active, ignored: _ignored, matchedAt: _matched, ...source } = pasivaPocitos()
    const read: ReadPlace = { ...source, benefits: [] }
    await ctx.store.apply(planDiscountWrites({
      providerId: 'santander', runId: 'r2', now: new Date('2026-11-11T00:00:00.000Z'),
      result: { places: [read], unread: [] },
      existing: await ctx.store.existing('santander'), candidates: [], inherited: [],
    }))
    expect((await ctx.searches())['santander:la-pasiva'][0].status).toBe('review')
  })
})
