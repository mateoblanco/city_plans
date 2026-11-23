import { describe, expect, it } from 'vitest'
import { guidesWithPlace, HOME_GUIDES_MAX, pickHomeGuides, relatedGuides } from '../entries'
import type { Guide } from '../types'
import { testGuide } from './fixtures'

const g = (slug: string, overrides: Partial<Guide> = {}) => testGuide({ slug, places: [{ id: `${slug}-1`, text: 'x' }], ...overrides })

describe('sección "Guías" de la home', () => {
  it('primero las destacadas (en el orden de la lista), después las más recientes', () => {
    const guides = [
      g('vieja', { updatedAt: '2026-01-01' }),
      g('destacada-1', { featured: true, updatedAt: '2025-01-01' }),
      g('nueva', { updatedAt: '2026-11-20' }),
      g('destacada-2', { featured: true }),
      g('media', { updatedAt: '2026-06-01' }),
    ]
    expect(pickHomeGuides(guides).map((guide) => guide.slug)).toEqual(['destacada-1', 'destacada-2', 'nueva', 'media', 'vieja'])
  })

  it(`hasta ${HOME_GUIDES_MAX}`, () => {
    const guides = Array.from({ length: 14 }, (_, index) => g(`guia-${index}`, { updatedAt: `2026-11-${String(index + 1).padStart(2, '0')}` }))
    const picked = pickHomeGuides(guides)
    expect(picked).toHaveLength(10)
    expect(picked[0].slug).toBe('guia-13')
  })

  it('sin borradores ni guías sin lugares publicados; vacío si no hay ninguna (la sección no aparece)', () => {
    expect(pickHomeGuides([g('borrador', { draft: true }), g('sin-lugares', { live: false })])).toEqual([])
    expect(pickHomeGuides([])).toEqual([])
  })

  it('cada una con su URL, el barrio (nombre visible, o null) y la cantidad de lugares publicados', () => {
    const [cordon, city] = pickHomeGuides([g('cafes', { neighborhood: 'CORDON', publishedPlaces: 9, updatedAt: '2026-11-20' }), g('sushi', { neighborhood: null, publishedPlaces: 4 })])
    expect(cordon).toEqual({ slug: 'cafes', title: 'Guía cafes', href: '/guides/montevideo/cafes', neighborhood: 'Cordón', count: 9 })
    expect(city.neighborhood).toBeNull()
  })
})

describe('"Aparece en estas guías" de la ficha', () => {
  it('sólo las guías publicadas con página que incluyen el lugar', () => {
    const place = 'lugar-x'
    const guides = [
      g('con-el-lugar', { places: [{ id: place, text: '' }] }),
      g('otra'),
      g('borrador', { draft: true, places: [{ id: place, text: '' }] }),
      g('sin-lugares-publicados', { live: false, places: [{ id: place, text: '' }] }),
    ]
    expect(guidesWithPlace(guides, place).map((guide) => guide.slug)).toEqual(['con-el-lugar'])
    expect(guidesWithPlace(guides, 'ninguno')).toEqual([])
  })
})

describe('"Más guías" al final de una guía', () => {
  const current = g('actual', { group: 'cafes', neighborhood: 'CORDON' })

  it('sin la actual: mismo grupo, después mismo barrio, después las más recientes; hasta 4', () => {
    const guides = [
      current,
      g('otro-grupo-otro-barrio-nueva', { group: 'eat', neighborhood: 'POCITOS', updatedAt: '2026-11-25' }),
      g('mismo-barrio', { group: 'bars', neighborhood: 'CORDON', updatedAt: '2026-01-01' }),
      g('mismo-grupo-vieja', { group: 'cafes', neighborhood: 'POCITOS', updatedAt: '2025-01-01' }),
      g('mismo-grupo-y-barrio', { group: 'cafes', neighborhood: 'CORDON', updatedAt: '2024-01-01' }),
      g('mismo-grupo-nueva', { group: 'cafes', neighborhood: null, updatedAt: '2026-11-01' }),
      g('otro-grupo-vieja', { group: 'desserts', neighborhood: null, updatedAt: '2020-01-01' }),
    ]
    expect(relatedGuides(current, guides).map((guide) => guide.slug)).toEqual(['mismo-grupo-y-barrio', 'mismo-grupo-nueva', 'mismo-grupo-vieja', 'mismo-barrio'])
    expect(relatedGuides(current, guides, 10).map((guide) => guide.slug).slice(4)).toEqual(['otro-grupo-otro-barrio-nueva', 'otro-grupo-vieja'])
  })

  it('con pocas, las que haya; sin otras, vacío (no aparece); nunca borradores ni sin lugares publicados', () => {
    expect(relatedGuides(current, [current, g('una')]).map((guide) => guide.slug)).toEqual(['una'])
    expect(relatedGuides(current, [current])).toEqual([])
    expect(relatedGuides(current, [current, g('borrador', { draft: true }), g('vacia', { live: false })])).toEqual([])
  })

  it('una guía de toda la ciudad no comparte barrio con otra de toda la ciudad', () => {
    const city = g('ciudad', { group: 'eat', neighborhood: null })
    const guides = [city, g('ciudad-2', { group: 'bars', neighborhood: null, updatedAt: '2026-01-01' }), g('reciente', { group: 'bars', neighborhood: 'CORDON', updatedAt: '2026-11-20' })]
    expect(relatedGuides(city, guides).map((guide) => guide.slug)).toEqual(['reciente', 'ciudad-2'])
  })
})
