import { describe, expect, it } from 'vitest'
import type { PlaceAnchor } from '../../src/types/places.ts'
import {
  canonicalizeName,
  matchPlace,
  scoreCandidate,
} from './place-match-provider.ts'

const anchor: PlaceAnchor = {
  name: 'Café Brasilero',
  address: 'Ituzaingó 1447, Montevideo',
  latitude: -34.906,
  longitude: -56.202,
}

describe('matching multi-fuente', () => {
  it.each([
    ['Café Brasilero', 'Cafe Brasilero'],
    ['Ñandú', 'Nandu'],
    ["L'Atelier", 'L’Atelier'],
    ['Straße', 'Strasse'],
    ['Smør', 'Smor'],
    ['Cœur', 'Coeur'],
    ['Ægir', 'Aegir'],
    ['Bar – Restaurante', 'Bar-Restaurante'],
  ])('normaliza %s y %s al mismo nombre', (left, right) => {
    expect(canonicalizeName(left)).toBe(canonicalizeName(right))
  })

  it('prioriza nombre, proximidad y dirección y limita los candidatos', async () => {
    const provider = {
      source: 'overture' as const,
      attribution: 'Overture',
      configured: true,
      findCandidates: async () => [
        {
          name: 'Cafe Brasilero',
          address: 'Ituzaingo 1447',
          latitude: -34.90601,
          longitude: -56.20201,
          data: { id: 'best' },
        },
        ...Array.from({ length: 7 }, (_, index) => ({
          name: `Otro café ${index}`,
          address: 'Otra calle',
          latitude: -34.906 + index * 0.00001,
          longitude: -56.202,
          data: { id: `other-${index}` },
        })),
      ],
    }

    const result = await matchPlace(provider, anchor)

    expect(result.candidates).toHaveLength(5)
    expect(result.matchMethod).toBe('spatial_name_v2')
    expect(result.bestMatch?.data).toEqual({ id: 'best' })
    expect(result.bestMatch?.score).toBeGreaterThan(0.9)
    expect(result.bestMatch?.matchEvidence).toMatchObject({
      anchorName: 'Café Brasilero',
      candidateName: 'Cafe Brasilero',
      normalizedAnchorName: 'cafe brasilero',
      normalizedCandidateName: 'cafe brasilero',
      nameSimilarity: 1,
    })
  })

  it('elige el alias con mayor similitud y lo informa como evidencia', () => {
    const result = scoreCandidate(anchor, {
      name: 'Nombre corporativo SA',
      alternativeNames: ['CB', 'Cafe Brasilero'],
      address: 'Ituzaingó 1447',
      latitude: -34.906,
      longitude: -56.202,
      data: { id: 'alias-match' },
    })

    expect(result.matchEvidence.candidateName).toBe('Cafe Brasilero')
    expect(result.matchEvidence.nameSimilarity).toBe(1)
    expect(result.score).toBeGreaterThan(0.9)
  })

  it('no afirma un match cuando el score no alcanza el umbral', async () => {
    const candidate = {
      name: 'Nombre sin relación',
      address: '',
      latitude: -34.906,
      longitude: -56.202,
      data: { id: 'candidate' },
    }
    const result = await matchPlace({
      source: 'overture',
      attribution: 'Overture',
      configured: true,
      findCandidates: async () => [candidate],
    }, anchor)

    expect(scoreCandidate(anchor, candidate).distanceMeters).toBe(0)
    expect(result.bestMatch).toBeNull()
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.matchEvidence.nameSimilarity).toBeLessThan(0.5)
  })
})
