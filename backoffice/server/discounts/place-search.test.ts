import { describe, expect, it } from 'vitest'
import type { FoundPlace } from '../providers/places-provider.ts'
import { chooseGoogleResult, sameAddress, searchQuery, type SearchTarget } from './place-search.ts'

const POCITOS = { lat: -34.9115, lng: -56.153 }
const CENTRO = { lat: -34.9055, lng: -56.1915 }

const found = (placeId: string, name: string, at: { lat: number; lng: number }, patch: Partial<FoundPlace> = {}): FoundPlace => ({
  placeId, name, address: 'Av. Brasil 2580, 11300 Montevideo, Uruguay', lat: at.lat, lng: at.lng, primaryType: 'restaurant', ...patch,
})
const target = (patch: Partial<SearchTarget> = {}): SearchTarget => ({ name: 'La Pasiva', neighborhoodId: 'POCITOS', address: null, coordinates: null, ...patch })
/** ~100 m al norte. */
const near = (at: { lat: number; lng: number }, meters: number) => ({ lat: at.lat + meters / 111_320, lng: at.lng })

describe('searchQuery', () => {
  it('nombre + dirección (o barrio) + Montevideo', () => {
    expect(searchQuery(target({ address: 'Av. Brasil 2580' }))).toBe('La Pasiva, Av. Brasil 2580, Montevideo')
    expect(searchQuery(target())).toBe('La Pasiva, Pocitos, Montevideo')
    expect(searchQuery(target({ neighborhoodId: null }))).toBe('La Pasiva, Montevideo')
  })
})

describe('chooseGoogleResult', () => {
  it('claro: nombre parecido y cerca de las coordenadas de la fuente; el nombre de Google con sucursal cuenta como la marca', () => {
    const choice = chooseGoogleResult(target({ coordinates: POCITOS }), [
      found('a', 'La Pasiva | Pocitos', near(POCITOS, 80)),
      found('b', 'Otra Cosa', near(POCITOS, 10)),
    ])
    expect(choice).toEqual({ kind: 'clear', place: expect.objectContaining({ placeId: 'a' }) })
  })

  it('lejos de las coordenadas no es claro: queda dudoso', () => {
    const choice = chooseGoogleResult(target({ coordinates: POCITOS }), [found('a', 'La Pasiva', CENTRO)])
    expect(choice).toEqual({ kind: 'doubtful', candidates: [expect.objectContaining({ placeId: 'a' })] })
  })

  it('con dirección y sin coordenadas: mismo barrio o la misma calle y número', () => {
    expect(chooseGoogleResult(target({ address: 'Av. Brasil 2580', neighborhoodId: null }), [found('a', 'La Pasiva', CENTRO)]).kind).toBe('clear')
    expect(chooseGoogleResult(target({ address: 'Soriano 1000', neighborhoodId: null }), [found('a', 'La Pasiva', CENTRO)]).kind).toBe('doubtful')
    expect(chooseGoogleResult(target({ address: 'Soriano 1000', neighborhoodId: 'POCITOS' }), [found('a', 'La Pasiva', POCITOS)]).kind).toBe('clear')
  })

  it('sin datos de ubicación alcanza con el nombre', () => {
    expect(chooseGoogleResult(target({ neighborhoodId: null }), [found('a', 'La Pasiva', CENTRO)]).kind).toBe('clear')
  })

  it('dos que pasan: dudoso, salvo que uno solo tenga el nombre normalizado igual', () => {
    const two = [found('a', 'La Pasiva', near(POCITOS, 50)), found('b', 'La Pasiva', near(POCITOS, 120))]
    expect(chooseGoogleResult(target({ coordinates: POCITOS }), two)).toEqual({ kind: 'doubtful', candidates: [expect.objectContaining({ placeId: 'a' }), expect.objectContaining({ placeId: 'b' })] })
    const oneExact = [found('a', 'La Pasiva', near(POCITOS, 50)), found('b', 'Las Pasivas', near(POCITOS, 120))]
    expect(chooseGoogleResult(target({ coordinates: POCITOS }), oneExact)).toEqual({ kind: 'clear', place: expect.objectContaining({ placeId: 'a' }) })
  })

  it('fuera de Montevideo no cuenta; sin nada parecido, no encontrado', () => {
    expect(chooseGoogleResult(target(), [found('a', 'La Pasiva', { lat: -34.6, lng: -55.9 })])).toEqual({ kind: 'not_found' })
    expect(chooseGoogleResult(target(), [found('a', 'Burger Time', POCITOS)])).toEqual({ kind: 'not_found' })
    expect(chooseGoogleResult(target(), [])).toEqual({ kind: 'not_found' })
  })

  it('dudoso con hasta 3 candidatos, los que pasan y los más parecidos primero; sin repetir', () => {
    const choice = chooseGoogleResult(target({ coordinates: POCITOS }), [
      found('far', 'La Pasiva', CENTRO),
      found('a', 'La Pasiva', near(POCITOS, 50)),
      found('a', 'La Pasiva', near(POCITOS, 50)),
      found('b', 'La Pasiva', near(POCITOS, 100)),
      found('c', 'Pasiva', near(POCITOS, 200)),
      found('d', 'La Pasiv', CENTRO),
    ])
    expect(choice.kind).toBe('doubtful')
    expect(choice.kind === 'doubtful' && choice.candidates.map((item) => item.placeId)).toEqual(['a', 'b', 'c'])
  })
})

describe('sameAddress', () => {
  it('calle y número, sin tildes ni prefijos', () => {
    expect(sameAddress('Av. Brasil 2580', 'Av. Brasil 2580, 11300 Montevideo')).toBe(true)
    expect(sameAddress('Bvar. Artigas 1100', 'Bulevar General Artigas 1100, Montevideo')).toBe(true)
    expect(sameAddress('Av. Brasil 2580', 'Av. Brasil 2590, Montevideo')).toBe(false)
    expect(sameAddress('Brasil s/n', 'Av. Brasil 2580')).toBe(false)
  })
})
