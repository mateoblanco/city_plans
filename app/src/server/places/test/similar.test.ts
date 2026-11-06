import { describe, expect, it } from 'vitest'
import { pickSimilar, similarCard, SIMILAR_MAX, type SimilarRow } from '../similar'

const place = { id: 'p', brand_key: 'marlon', icon_category: 'cocktails' as const, tags: ['classic_cocktails'], style: 'casual', price: 'moderate' }

const row = (id: string, similarity: number, overrides: Partial<SimilarRow> = {}): SimilarRow => ({
  id,
  discounts: [],
  slug: id,
  name: id,
  neighborhoodId: 'POCITOS',
  categories: ['bar'],
  tags: [],
  style: 'casual',
  price: 'moderate',
  hours: { slots: [], status: 'none' },
  iconCategory: 'cocktails',
  logoKey: null,
  logoBgColor: null,
  locatedIn: null,
  brandKey: null,
  brandCount: 1,
  lat: -34.9,
  lng: -56.15,
  similarity,
  ...overrides,
})

describe('pickSimilar', () => {
  it('ordena por parecido y corta en SIMILAR_MAX', () => {
    const rows = Array.from({ length: 8 }, (_, index) => row(`r${index}`, 0.7 + index / 100))
    const chosen = pickSimilar(place, rows)
    expect(chosen).toHaveLength(SIMILAR_MAX)
    expect(chosen.map((item) => item.id)).toEqual(['r7', 'r6', 'r5', 'r4', 'r3', 'r2'])
  })

  it('nunca el lugar ni sus sucursales, y una sola sucursal por marca', () => {
    const chosen = pickSimilar(place, [
      row('p', 1),
      row('sucursal', 0.95, { brandKey: 'marlon' }),
      row('a1', 0.9, { brandKey: 'otra' }),
      row('a2', 0.89, { brandKey: 'otra' }),
      row('b', 0.8),
    ])
    expect(chosen.map((item) => item.id)).toEqual(['a1', 'b'])
  })

  it('aplica los datos concretos de "Parecido a": familia, style y precio a un nivel', () => {
    const chosen = pickSimilar(place, [
      row('cafe', 0.9, { iconCategory: 'coffee' }),
      row('cuidado', 0.9, { style: 'cuidado' }),
      row('caro', 0.9, { price: 'high' }),
      row('barato', 0.9, { price: 'low' }),
      row('sinEstilo', 0.9, { style: null }),
    ])
    expect(chosen.map((item) => item.id).sort()).toEqual(['barato', 'caro', 'sinEstilo'])
  })

  it('sin coincidencias, vacío (la sección se oculta)', () => {
    expect(pickSimilar(place, [])).toEqual([])
  })
})

describe('similarCard', () => {
  it('arma el resultado de la card con el barrio, sin motivos ni sucursales', () => {
    const card = similarCard(row('a', 0.9, { brandKey: 'otra', brandCount: 2 }), new Date('2026-11-04T15:00:00Z'))
    expect(card).toMatchObject({ id: 'a', slug: 'a', neighborhood: 'Pocitos', branchCount: 2, branches: [], reasons: [], matchLevel: 'has' })
    expect(card.openStatus.tone).toBe('unconfirmed')
  })
})
