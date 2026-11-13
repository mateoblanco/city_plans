import { describe, expect, it } from 'vitest'
import type { MatchablePlace } from './match.ts'
import { suggestOurPlaces } from './suggestions.ts'

const POCITOS = { lat: -34.9115, lng: -56.153 }
const north = (meters: number) => ({ lat: POCITOS.lat + meters / 111_320, lng: POCITOS.lng })
const ours = (id: string, name: string, patch: Partial<MatchablePlace> = {}): MatchablePlace => ({ id, name, neighborhoodId: 'POCITOS', brandKey: null, instagram: null, location: null, ...patch })

describe('suggestOurPlaces', () => {
  const places = [
    ours('far-same', 'Lo de Tere', { location: north(5000) }),
    ours('near-other', 'Café Brasilero', { location: north(40) }),
    ours('near-far', 'Bar del Puerto', { location: north(250) }),
    ours('too-far', 'Otro', { location: north(400) }),
    ours('insta', 'Nombre Distinto', { instagram: '@LoDeTere' }),
    ours('similar', 'Lo de Teresa'),
    ours('unrelated', 'Kamba'),
  ]

  it('cerca (≤ 300 m) aunque el nombre sea otro, por distancia; después los nombres parecidos con puntaje', () => {
    const result = suggestOurPlaces({ name: 'Lo de Tere', coordinates: POCITOS, instagram: null }, places)
    expect(result.filter((item) => item.reason === 'near').map((item) => [item.placeId, item.meters])).toEqual([['near-other', 40], ['near-far', 250]])
    const byName = result.filter((item) => item.reason === 'name')
    expect(byName[0]).toMatchObject({ placeId: 'far-same', score: 1, meters: expect.any(Number) })
    expect(byName.map((item) => item.placeId)).toContain('similar')
    expect(result.map((item) => item.placeId)).not.toContain('too-far')
    expect(result.map((item) => item.placeId)).not.toContain('unrelated')
  })

  it('mismo Instagram y candidatos del cruce van primero; sin repetir', () => {
    const result = suggestOurPlaces({ name: 'Lo de Tere', coordinates: null, instagram: 'lodetere', candidateIds: ['similar'] }, places)
    expect(result.slice(0, 2)).toEqual([
      expect.objectContaining({ placeId: 'similar', reason: 'candidate' }),
      expect.objectContaining({ placeId: 'insta', reason: 'instagram', meters: null }),
    ])
    expect(new Set(result.map((item) => item.placeId)).size).toBe(result.length)
  })

  it('sin coordenadas no hay "cerca"', () => {
    expect(suggestOurPlaces({ name: 'Café', coordinates: null, instagram: null }, places).some((item) => item.reason === 'near')).toBe(false)
  })
})
