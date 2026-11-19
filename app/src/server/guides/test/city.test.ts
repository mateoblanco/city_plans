import { describe, expect, it } from 'vitest'
import { cityNeighborhoods, CITY_GROUP_MAX, pickCityGroups, pickGroupGuides } from '../city'
import type { GuidePlaceRow } from '../places'
import type { Guide, GuideGroup } from '../types'

const row = (id: string): GuidePlaceRow => ({
  id,
  slug: id,
  name: id.toUpperCase(),
  neighborhoodId: 'CORDON',
  categories: ['cafe'],
  iconCategory: null,
  logoKey: null,
  logoBgColor: null,
  hours: { slots: [], status: 'none' },
  lat: -34.9,
  lng: -56.17,
})

type Options = { neighborhood?: string; featured?: boolean; updatedAt?: string; ids?: string[] }
const guide = (slug: string, group: GuideGroup, options: Options = {}): Guide => ({
  slug,
  city: 'montevideo',
  ...(options.neighborhood ? { neighborhood: options.neighborhood } : {}),
  group,
  title: `Guía ${slug}`,
  seoTitle: slug,
  seoDescription: slug,
  intro: [],
  updatedAt: options.updatedAt ?? '2026-11-01',
  places: (options.ids ?? ['a']).map((id) => ({ id, text: `Texto de ${id}` })),
  ...(options.featured ? { featured: true } : {}),
})

const rows = ['a', 'b', 'c'].map(row)
const noLogo = () => null
const slugs = (guides: Guide[]) => guides.map((entry) => entry.slug)

describe('qué guías van en cada grupo de la ciudad', () => {
  it('con destacadas: sólo las destacadas, en el orden del archivo', () => {
    const picked = pickGroupGuides([guide('vieja', 'eat'), guide('dest-1', 'eat', { featured: true }), guide('nueva', 'eat', { updatedAt: '2026-12-01' }), guide('dest-2', 'eat', { featured: true })])
    expect(slugs(picked)).toEqual(['dest-1', 'dest-2'])
  })

  it('sin destacadas: las más recientes primero; a igual fecha, el orden del archivo', () => {
    const picked = pickGroupGuides([
      guide('uno', 'eat', { updatedAt: '2026-10-01' }),
      guide('dos', 'eat', { updatedAt: '2026-11-15' }),
      guide('tres', 'eat', { updatedAt: '2026-11-15' }),
      guide('cuatro', 'eat', { updatedAt: '2026-11-01' }),
    ])
    expect(slugs(picked)).toEqual(['dos', 'tres', 'cuatro', 'uno'])
  })

  it(`hasta ${CITY_GROUP_MAX} por grupo (destacadas o recientes)`, () => {
    const many = (featured: boolean) => Array.from({ length: 9 }, (_, i) => guide(`g${i}`, 'eat', { featured, updatedAt: `2026-11-${String(10 + i)}` }))
    expect(pickGroupGuides(many(true))).toHaveLength(CITY_GROUP_MAX)
    expect(slugs(pickGroupGuides(many(false)))).toEqual(['g8', 'g7', 'g6', 'g5', 'g4', 'g3'])
  })
})

describe('filas de la ciudad', () => {
  it('mezcla guías de barrio y de ciudad, en el orden de la app; un grupo sin guías no se muestra', () => {
    const groups = pickCityGroups(
      [guide('dulces', 'desserts', { neighborhood: 'CORDON' }), guide('sushi', 'eat'), guide('brunch', 'eat', { neighborhood: 'POCITOS', updatedAt: '2026-11-18' })],
      rows,
      noLogo,
    )
    expect(groups.map((group) => [group.group, group.title, group.guides.map((card) => card.href)])).toEqual([
      ['eat', 'Comer', ['/guides/montevideo/pocitos/brunch', '/guides/montevideo/sushi']],
      ['desserts', 'Postres', ['/guides/montevideo/cordon/dulces']],
    ])
  })

  it('una destacada sin lugares publicados no cuenta: el grupo cae a las más recientes con lugares', () => {
    const groups = pickCityGroups([guide('vacia', 'cafes', { featured: true, ids: ['zz'] }), guide('con-lugares', 'cafes')], rows, noLogo)
    expect(groups.map((group) => group.guides.map((card) => card.slug))).toEqual([['con-lugares']])
  })
})

describe('sección Barrios', () => {
  it('sólo los barrios con alguna guía con lugares publicados, en orden alfabético, con link a su página', () => {
    const guides = [
      guide('a', 'eat', { neighborhood: 'POCITOS' }),
      guide('b', 'cafes', { neighborhood: 'CORDON' }),
      guide('c', 'cafes', { neighborhood: 'AGUADA', ids: ['zz'] }),
      guide('d', 'eat', { neighborhood: 'BUCEO' }),
      guide('ciudad', 'eat'),
      guide('e', 'bars', { neighborhood: 'CORDON' }),
    ]
    expect(cityNeighborhoods(guides, rows)).toEqual([
      { id: 'BUCEO', name: 'Buceo', href: '/guides/montevideo/buceo' },
      { id: 'CORDON', name: 'Cordón', href: '/guides/montevideo/cordon' },
      { id: 'POCITOS', name: 'Pocitos', href: '/guides/montevideo/pocitos' },
    ])
  })

  it('ordena con tildes como en español (Ituzaingó entre Ituzaingo y Jacinto Vera)', () => {
    const names = cityNeighborhoods([guide('x', 'eat', { neighborhood: 'JACINTO VERA' }), guide('y', 'eat', { neighborhood: 'ITUZAINGO' }), guide('z', 'eat', { neighborhood: 'AGUADA' })], rows).map((entry) => entry.name)
    expect(names).toEqual(['Aguada', 'Ituzaingó', 'Jacinto Vera'])
  })
})
