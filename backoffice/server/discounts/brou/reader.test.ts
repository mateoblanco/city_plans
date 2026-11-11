import { describe, expect, it } from 'vitest'
import { getBarrio } from '../../../src/lib/getNeighborhood.ts'
import type { GeocodeQuery, Geocoder } from '../geocode.ts'
import { matchPlace, type MatchablePlace } from '../match.ts'
import { memoryDiscountStore } from '../memory-store.ts'
import type { PageFetcher } from '../polite-fetch.ts'
import { discountProviders } from '../providers.ts'
import type { ProviderReader } from '../reader.ts'
import { runDiscounts } from '../run.ts'
import { BROU, CAMPAIGN, campaignHtml, listadoPdf, PDF, recordedSplit } from './fixtures.ts'
import { readBrou } from './reader.ts'
import { validateRows, type RowSplitter } from './split-rows.ts'

function fetcherOf(pages: Record<string, string>, files: Record<string, Uint8Array>): PageFetcher {
  return {
    requests: 0,
    async get(url) {
      if (!(url in pages)) throw new Error(`${url} respondió 404.`)
      return pages[url]
    },
    async getBytes(url) {
      if (!(url in files)) throw new Error(`${url} respondió 404.`)
      return files[url]
    },
  }
}

/** La separación grabada de Haiku, validada igual que la real. */
const recordedSplitter = (): RowSplitter => {
  const recorded = recordedSplit()
  return async (block) => ({ ...validateRows(block, recorded[block.department]), costUsd: 0, cached: true, method: 'model', modelCalls: 0 })
}

/** Coordenadas reales de la IDE para algunas direcciones (el resto, sin resultado). */
const KNOWN: Record<string, { lat: number; lng: number }> = {
  'PIEDRAS 284': { lat: -34.905722573099844, lng: -56.210687276036346 },
  '26 DE MARZO 3353': { lat: -34.90646, lng: -56.14086 },
  'CONSTITUYENTE 1515': { lat: -34.90576, lng: -56.18265 },
  'JUAN BENITO BLANCO 866': { lat: -34.91569, lng: -56.14977 },
  'MERCEDES 871': { lat: -34.90438629097189, lng: -56.19782232193091 },
}
function fakeGeocoder(): Geocoder & { queries: GeocodeQuery[] } {
  const queries: GeocodeQuery[] = []
  return {
    queries,
    requests: 0,
    async geocode(query) {
      queries.push(query)
      const hit = KNOWN[query.address]
      return hit ? { hit: { ...hit, matched: query.address }, cached: false, reason: null } : { hit: null, cached: false, reason: 'sin resultado' }
    },
  }
}

// Sin splitRows: por las celdas del PDF, sin modelo.
const read = (geocoder: Geocoder = fakeGeocoder()) => readBrou({
  provider: BROU,
  fetcher: fetcherOf({ [CAMPAIGN]: campaignHtml() }, { [PDF]: listadoPdf() }),
  geocoder,
})

describe('readBrou', () => {
  it('la campaña real: todos los departamentos, un lugar por departamento y nombre, con los beneficios de la página', async () => {
    const geocoder = fakeGeocoder()
    const result = await read(geocoder)
    expect(result.errors).toEqual([])
    expect(result.unread).toEqual([])
    const byDepartment = new Map<string, number>()
    for (const place of result.places) byDepartment.set(place.departments[0], (byDepartment.get(place.departments[0]) ?? 0) + place.locations.length)
    expect(Object.fromEntries(byDepartment)).toMatchObject({ Montevideo: 43, Maldonado: 20, Canelones: 10, Paysandú: 7, 'Treinta y Tres': 1 })
    expect([...byDepartment.values()].reduce((a, b) => a + b, 0)).toBe(125)

    // Mismo nombre en el mismo departamento: un lugar con varios locales.
    const fans = result.places.find((place) => place.id === 'brou:montevideo:rest-fans')!
    expect(fans).toMatchObject({ sourceName: 'REST FANS', city: 'MONTEVIDEO', departments: ['Montevideo'], montevideo: true, sourceUrl: CAMPAIGN, sourceTags: ['Gastronomía Verano 2026-2027'] })
    expect(fans.locations.map((location) => location.address)).toEqual(['26 DE MARZO 3353', 'CONSTITUYENTE 1515', 'JUAN BENITO BLANCO 866'])
    expect(fans.locations.every((location) => location.coordinates)).toBe(true)
    expect(fans.campaign).toMatchObject({ validFrom: '2026-11-01', validTo: '2027-02-28' })
    expect(fans.benefits.map((benefit) => [benefit.percent, benefit.cardType, benefit.mode, benefit.sourceUrl])).toEqual([
      [30, 'credit', 'refund', CAMPAIGN], [20, 'credit', 'refund', CAMPAIGN], [10, 'debit', 'refund', CAMPAIGN],
    ])
    expect(new Set(fans.benefits.map((benefit) => benefit.id)).size).toBe(3)

    // Rikuras está en Canelones (Pinar) y en Montevideo: dos lugares; sólo el de Montevideo se cruza y se geocodifica.
    const rikuras = result.places.filter((place) => place.sourceName === 'RIKURAS SIN GLUTEN').map((place) => [place.id, place.montevideo, 'coordinates' in place.locations[0] ? place.locations[0].coordinates : 'sin geocodificar'])
    expect(rikuras).toEqual([['brou:canelones:rikuras-sin-gluten', false, 'sin geocodificar'], ['brou:montevideo:rikuras-sin-gluten', true, null]])
    expect(geocoder.queries).toHaveLength(43)
    expect(geocoder.queries.every((query) => query.department === 'Montevideo')).toBe(true)

    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Gastronomía Verano 2026-2027: Artigas 3, .*Montevideo 43, .* \(PDF Listado GASTRONOMIA 6\.11\.26\.pptx\.pdf\)\.$/),
      'Geocodificador (IDE Uruguay): 5 de 43 locales de Montevideo con coordenadas (0 del cache, 0 pedidos).',
    ]))
  })

  it('barrio por coordenadas y cruce por distancia + nombre (como Santander)', async () => {
    const result = await read()
    const burger = result.places.find((place) => place.id === 'brou:montevideo:burger-house-284')!
    const coordinates = burger.locations[0].coordinates!
    expect(getBarrio(coordinates.lat, coordinates.lng)).toBe('CIUDAD VIEJA')
    const near = (meters: number) => ({ lat: coordinates.lat + meters / 111_000, lng: coordinates.lng })
    const ours: MatchablePlace[] = [
      { id: 'p1', name: 'Burger House', neighborhoodId: 'CIUDAD VIEJA', brandKey: null, instagram: null, location: near(40) },
      { id: 'p2', name: 'Café Brasilero', neighborhoodId: 'CIUDAD VIEJA', brandKey: null, instagram: null, location: near(10) },
    ]
    expect(matchPlace(burger, ours)).toMatchObject({ status: 'found', links: [expect.objectContaining({ placeId: 'p1', locationIndex: 0 })] })
    // Nombre parecido pero a más de 150 m: no cruza (queda como candidato lejano si es muy parecido).
    expect(matchPlace(burger, [{ ...ours[0], location: near(400) }]).status).toBe('doubtful')

    // Sin coordenadas (dirección que no se geocodificó): por nombre, dudoso si no es claro.
    const deli = result.places.find((place) => place.id === 'brou:montevideo:deli-14')!
    expect(deli.locations.every((location) => location.coordinates === null)).toBe(true)
    expect(matchPlace(deli, [{ id: 'p3', name: 'Deli 14', neighborhoodId: 'CENTRO', brandKey: null, instagram: null, location: null }]).status).toBe('doubtful')
    expect(matchPlace(deli, []).status).toBe('missing')

    // Fuera de Montevideo no se cruza.
    const calis = result.places.find((place) => place.id === 'brou:artigas:calis')!
    expect(matchPlace(calis, ours).status).toBe('not_matched')
  })

  it('sin link al PDF o sin PDF legible: error del proveedor (nunca una lista vacía)', async () => {
    const noLink = campaignHtml().replace(/href="https:\/\/beneficios\.brou\.com\.uy\/pdf\/[^"]+"/, 'href="#"')
    await expect(readBrou({ provider: BROU, fetcher: fetcherOf({ [CAMPAIGN]: noLink }, {}), splitRows: recordedSplitter() })).rejects.toThrow(/no tiene el link al PDF/)
    await expect(readBrou({ provider: BROU, fetcher: fetcherOf({ [CAMPAIGN]: campaignHtml() }, { [PDF]: new Uint8Array([1, 2, 3]) }), splitRows: recordedSplitter() })).rejects.toThrow(/No se pudo leer el PDF/)
  })

  it('por celdas, igual que la separación grabada de Haiku y sin llamar al modelo', async () => {
    const byCells = await read()
    const byModel = await readBrou({ provider: BROU, fetcher: fetcherOf({ [CAMPAIGN]: campaignHtml() }, { [PDF]: listadoPdf() }), splitRows: recordedSplitter(), geocoder: fakeGeocoder() })
    expect(byCells.places).toEqual(byModel.places)
    expect(byCells.llm).toEqual({ calls: 0, costUsd: 0 })
    expect(byCells.notes).toContain('Nombre y dirección: 18 departamentos por las celdas del PDF; 0 con el modelo (0 filas).')
  })

  it('si un departamento no se puede separar, error del proveedor (no se inactiva ese departamento)', async () => {
    const recorded = recordedSplit()
    const broken: RowSplitter = async (block) => {
      if (block.department === 'Rocha') throw new Error('no rearman')
      return { ...validateRows(block, recorded[block.department]), costUsd: 0, cached: true, method: 'model', modelCalls: 0 }
    }
    await expect(readBrou({ provider: BROU, fetcher: fetcherOf({ [CAMPAIGN]: campaignHtml() }, { [PDF]: listadoPdf() }), splitRows: broken })).rejects.toThrow(/No se pudieron separar nombre y dirección de Rocha/)
  })

  it('un error de red del geocodificador es un error parcial: el local queda sin coordenadas', async () => {
    const failing: Geocoder = { requests: 0, async geocode() { throw new Error('timeout') } }
    const result = await read(failing)
    expect(result.errors).toHaveLength(43)
    expect(result.places.filter((place) => place.montevideo).every((place) => place.locations.every((location) => location.coordinates === null))).toBe(true)
  })

  it('otra campaña con su propio PDF: el mismo local en las dos es un lugar con los beneficios de cada una', async () => {
    const second = 'https://beneficios.brou.com.uy/gastronomia/otra-campana'
    const secondPdf = 'https://beneficios.brou.com.uy/pdf/otra.pdf'
    const html = campaignHtml().replace(PDF, secondPdf).replace('<h1>Gastronomía Verano 2026-2027</h1>', '<h1>Otra campaña</h1>').replace(/30% de descuento con tarjetas de crédito BROU VISA Platinum/g, '25% de descuento con tarjetas de crédito BROU VISA Platinum')
    const provider = { ...BROU, pages: [...BROU.pages!, { url: second, label: 'Otra campaña' }] }
    const result = await readBrou({ provider, fetcher: fetcherOf({ [CAMPAIGN]: campaignHtml(), [second]: html }, { [PDF]: listadoPdf(), [secondPdf]: listadoPdf() }), splitRows: recordedSplitter(), geocoder: fakeGeocoder() })
    const fans = result.places.find((place) => place.id === 'brou:montevideo:rest-fans')!
    expect(fans.sourceTags).toEqual(['Gastronomía Verano 2026-2027', 'Otra campaña'])
    expect(fans.locations).toHaveLength(3)
    expect(fans.benefits.map((benefit) => [benefit.percent, benefit.sourceUrl])).toEqual([[30, CAMPAIGN], [20, CAMPAIGN], [10, CAMPAIGN], [25, second], [20, second], [10, second]])
    expect(new Set(fans.benefits.map((benefit) => benefit.id)).size).toBe(6)
  })
})

describe('corrida con BROU', () => {
  it('si BROU falla, los demás se guardan igual', async () => {
    const store = memoryDiscountStore([])
    const providers = discountProviders().filter((provider) => provider.id === 'bbva' || provider.id === 'brou')
    const bbva: ProviderReader = async () => ({
      places: [{ id: 'bbva:x', providerId: 'bbva', sourceName: 'X', category: null, city: null, departments: ['Montevideo'], montevideo: true, locations: [], website: null, instagram: null, sourceUrl: 'https://bank.test/x', logoUrl: null, description: null, sourceTags: [], campaign: { validFrom: null, validTo: null, text: null }, benefits: [] }],
      unread: [], errors: [], warnings: [], llm: { calls: 0, costUsd: 0 },
    })
    const run = await runDiscounts({
      providers,
      readers: { bbva, brou: readBrou },
      fetcherFor: async (_runId, providerId) => (providerId === 'brou' ? fetcherOf({}, {}) : { get: async () => '', requests: 0 }),
      candidates: async () => [],
      store,
    })
    expect(run.providers.map((provider) => [provider.providerId, provider.status])).toEqual([['bbva', 'ok'], ['brou', 'error']])
    expect(await store.get('bbva:x')).toMatchObject({ active: true })
  })
})
