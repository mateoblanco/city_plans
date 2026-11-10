import { describe, expect, it } from 'vitest'
import { groupByNeighborhood, memberKey, NO_NEIGHBORHOOD_LABEL, rowSearch } from '../../src/lib/discount-missing.ts'
import type { DiscountPlace, ProviderPlaceLocation, StoredBenefit, StoredPlaceSearch } from '../../src/types/discounts.ts'
import { missingRows } from './missing.ts'

const POCITOS = { lat: -34.9115, lng: -56.153 }
const CENTRO = { lat: -34.9055, lng: -56.1915 }

const benefit: StoredBenefit = {
  id: 'b', percent: 20, cardType: 'debit', cardTiers: [], cardProgram: null, days: 'all', daysText: null, mode: 'instant', instantPercent: null, refundPercent: null,
  cap: null, validFrom: null, validTo: null, conditions: null, sourceText: '20%', sourceUrl: null, parsedBy: 'html',
  firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-01T00:00:00.000Z', active: true, expired: false,
}

const location = (patch: Partial<ProviderPlaceLocation> = {}): ProviderPlaceLocation => ({ address: 'Av. Brasil 2580', area: null, department: null, mapsUrl: null, ...patch })

function place(id: string, sourceName: string, patch: Partial<DiscountPlace> = {}): DiscountPlace {
  return {
    id, providerId: id.split(':')[0], sourceName, category: null, city: null, departments: ['Montevideo'], montevideo: true, locations: [],
    website: null, instagram: null, sourceUrl: `https://bank.test/${id}`, logoUrl: null, description: null, sourceTags: [],
    campaign: { validFrom: null, validTo: null, text: null }, benefits: [benefit],
    match: { status: 'missing', origin: 'auto', links: [], candidates: [], missingBranches: 0, nearby: [] },
    firstSeenAt: '2026-11-01T00:00:00.000Z', lastSeenAt: '2026-11-01T00:00:00.000Z', active: true, ignored: false, matchedAt: null, ...patch,
  }
}

const summary = (places: DiscountPlace[]) => groupByNeighborhood(missingRows(places)).map((group) => ({
  barrio: group.label,
  rows: group.rows.map((row) => ({ name: row.name, providers: row.providerIds, members: row.members.map((member) => member.key) })),
}))

describe('missingRows', () => {
  it('barrio: BBVA por el que escribe la fuente, Santander por coordenadas, Itaú sin dirección en "Sin barrio"', () => {
    const groups = summary([
      place('bbva:la-pasiva', 'La Pasiva', { locations: [location({ area: 'Pocitos' })] }),
      place('santander:chivitos', 'Chivitos Marcos', { locations: [location({ address: 'Soriano 1000', coordinates: CENTRO })] }),
      place('itau:montevideo:dos-orientales', 'Dos Orientales'),
    ])
    expect(groups).toEqual([
      { barrio: 'Centro', rows: [{ name: 'Chivitos Marcos', providers: ['santander'], members: ['santander:chivitos#0'] }] },
      { barrio: 'Pocitos', rows: [{ name: 'La Pasiva', providers: ['bbva'], members: ['bbva:la-pasiva#0'] }] },
      { barrio: NO_NEIGHBORHOOD_LABEL, rows: [{ name: 'Dos Orientales', providers: ['itau'], members: ['itau:montevideo:dos-orientales#x'] }] },
    ])
  })

  it('sólo Montevideo, activos con beneficios vigentes, no ignorados y "no está en la base"', () => {
    const rows = missingRows([
      place('bbva:a', 'Activo'),
      place('bbva:b', 'Inactivo', { active: false }),
      place('bbva:c', 'Sin vigentes', { benefits: [{ ...benefit, active: false }] }),
      place('bbva:d', 'Ignorado', { ignored: true }),
      place('bbva:e', 'Encontrado', { match: { status: 'found', origin: 'auto', links: [], candidates: [], missingBranches: 0, nearby: [] } }),
      place('bbva:f', 'Afuera', { montevideo: false }),
    ])
    expect(rows.map((row) => row.name)).toEqual(['Activo'])
  })

  it('un local por fila: una cadena con locales en dos barrios son dos filas; los de otro departamento no entran', () => {
    const rows = missingRows([place('santander:la-pasiva', 'La Pasiva', {
      locations: [location({ coordinates: POCITOS }), location({ address: 'Soriano 1000', coordinates: CENTRO }), location({ address: 'Ruta 10', department: 'Maldonado' })],
    })])
    expect(rows.map((row) => [row.neighborhoodId, row.members.map((member) => member.key)])).toEqual([
      ['POCITOS', ['santander:la-pasiva#0']],
      ['CENTRO', ['santander:la-pasiva#1']],
    ])
  })

  it('une proveedores con el mismo nombre normalizado y el mismo barrio; en otro barrio, no', () => {
    const groups = summary([
      place('bbva:la-pasiva', 'La Pasiva', { locations: [location({ area: 'Pocitos' })] }),
      place('santander:la-pasiva', 'LA PASIVA (Pocitos)', { sourceName: 'La Pásiva', locations: [location({ coordinates: POCITOS })] }),
      place('santander:la-pasiva-centro', 'La Pasiva', { locations: [location({ address: 'Soriano 1000', coordinates: CENTRO })] }),
    ])
    expect(groups).toEqual([
      { barrio: 'Centro', rows: [{ name: 'La Pasiva', providers: ['santander'], members: ['santander:la-pasiva-centro#0'] }] },
      { barrio: 'Pocitos', rows: [{ name: 'La Pasiva', providers: ['bbva', 'santander'], members: ['bbva:la-pasiva#0', 'santander:la-pasiva#0'] }] },
    ])
  })

  it('un local sin barrio (Itaú) se suma a todas las filas con barrio de ese nombre, y no queda suelto', () => {
    const groups = summary([
      place('bbva:la-pasiva', 'La Pasiva', { locations: [location({ area: 'Pocitos' })] }),
      place('santander:la-pasiva', 'La Pasiva', { locations: [location({ address: 'Soriano 1000', coordinates: CENTRO })] }),
      place('itau:montevideo:la-pasiva', 'La pasiva'),
    ])
    expect(groups).toEqual([
      { barrio: 'Centro', rows: [{ name: 'La Pasiva', providers: ['itau', 'santander'], members: ['santander:la-pasiva#0', 'itau:montevideo:la-pasiva#x'] }] },
      { barrio: 'Pocitos', rows: [{ name: 'La Pasiva', providers: ['bbva', 'itau'], members: ['bbva:la-pasiva#0', 'itau:montevideo:la-pasiva#x'] }] },
    ])
  })

  it('dos sin barrio con el mismo nombre son una fila en "Sin barrio"; las palabras genéricas no cuentan', () => {
    const groups = summary([
      place('itau:montevideo:kamba', 'Kamba'),
      place('itau-personal-bank:montevideo:kamba', 'Restaurante Kamba'),
      place('itau:montevideo:otro', 'Otro Lugar'),
    ])
    expect(groups).toEqual([{
      barrio: NO_NEIGHBORHOOD_LABEL,
      rows: [
        { name: 'Kamba', providers: ['itau', 'itau-personal-bank'], members: ['itau:montevideo:kamba#x', 'itau-personal-bank:montevideo:kamba#x'] },
        { name: 'Otro Lugar', providers: ['itau'], members: ['itau:montevideo:otro#x'] },
      ],
    }])
  })

  it('la ciudad de la fuente da el barrio si nombra uno solo', () => {
    const [row] = missingRows([place('bbva:x', 'Lo de Pepe', { city: 'Carrasco, Montevideo' })])
    expect(row.neighborhoodId).toBe('CARRASCO')
  })

  it('la clave de la fila es estable (no depende del orden) y la ubicación prefiere coordenadas', () => {
    const a = place('bbva:la-pasiva', 'La Pasiva', { locations: [location({ area: 'Pocitos', address: 'Av. Brasil 2580' })] })
    const b = place('santander:la-pasiva', 'La Pasiva', { locations: [location({ address: 'Brasil 2580', coordinates: POCITOS })] })
    const [first] = missingRows([a, b])
    const [second] = missingRows([b, a])
    expect(first.key).toBe(second.key)
    expect(first.key).toBe(`${memberKey('bbva:la-pasiva', 0)}|${memberKey('santander:la-pasiva', 0)}`)
    expect(first.coordinates).toEqual(POCITOS)
    expect(first.address).toBe('Brasil 2580')
  })
})

describe('rowSearch', () => {
  const search = (patch: Partial<StoredPlaceSearch>): StoredPlaceSearch => ({
    locationIndex: 0, status: 'not_found', searchedAt: '2026-11-08T10:00:00.000Z', googlePlaceId: null, location: null, candidates: [], placeId: null, error: null, ourPlace: null, ...patch,
  })

  it('la búsqueda más reciente de los locales dueños de la fila; la del sin barrio sumado no cuenta', () => {
    const [pocitos] = missingRows([
      place('bbva:la-pasiva', 'La Pasiva', { locations: [location({ area: 'Pocitos' })] }),
      place('santander:la-pasiva', 'La Pasiva', { locations: [location({ coordinates: POCITOS })] }),
      place('itau:montevideo:la-pasiva', 'La Pasiva'),
    ])
    const found = rowSearch(pocitos, {
      'bbva:la-pasiva': [search({ status: 'not_found' })],
      'santander:la-pasiva': [search({ status: 'review', searchedAt: '2026-11-09T10:00:00.000Z' }), search({ locationIndex: 1, status: 'error', searchedAt: '2026-11-10T10:00:00.000Z' })],
      'itau:montevideo:la-pasiva': [search({ locationIndex: null, status: 'exists', searchedAt: '2026-11-11T10:00:00.000Z' })],
    })
    expect(found?.status).toBe('review')
    expect(rowSearch(pocitos, {})).toBeNull()
  })
})
