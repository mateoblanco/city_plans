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
  lat: -34.9,
  lng: -56.17,
})

type Options = { neighborhood?: string; featured?: boolean; updatedAt?: string; ids?: string[] }
const guide = (slug: string, group: GuideGroup, options: Options = {}): Guide => ({
  id: slug,
  slug,
  city: 'montevideo',
  neighborhood: options.neighborhood ?? null,
  draft: false,
  live: true,
  publishedPlaces: 1,
  group,
  title: `Guía ${slug}`,
  seoTitle: slug,
  seoDescription: slug,
  intro: [],
  updatedAt: options.updatedAt ?? '2026-11-01',
  featured: options.featured ?? false,
  color: '#FF8E00',
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
      ['eat', 'Comer', ['/guides/montevideo/brunch', '/guides/montevideo/sushi']],
      ['desserts', 'Postres', ['/guides/montevideo/dulces']],
    ])
  })

  it('una destacada sin lugares publicados no cuenta: el grupo cae a las más recientes con lugares', () => {
    const groups = pickCityGroups([guide('vacia', 'cafes', { featured: true, ids: ['zz'] }), guide('con-lugares', 'cafes')], rows, noLogo)
    expect(groups.map((group) => group.guides.map((card) => card.slug))).toEqual([['con-lugares']])
  })
})

describe('sección Barrios', () => {
  it('sólo los barrios con el mínimo de guías con página, en orden alfabético, con link a su página', () => {
    const guides = [
      ...['a1', 'a2', 'a3'].map((slug) => guide(slug, 'eat', { neighborhood: 'POCITOS' })),
      ...['b1', 'b2', 'b3'].map((slug) => guide(slug, 'cafes', { neighborhood: 'CORDON' })),
      // Buceo: dos con página y una sin lugares publicados (no cuenta).
      guide('c1', 'eat', { neighborhood: 'BUCEO' }),
      guide('c2', 'eat', { neighborhood: 'BUCEO' }),
      { ...guide('c3', 'eat', { neighborhood: 'BUCEO' }), live: false },
      guide('ciudad', 'eat'),
    ]
    expect(cityNeighborhoods(guides)).toEqual([
      { id: 'CORDON', name: 'Cordón', href: '/guides/montevideo/cordon' },
      { id: 'POCITOS', name: 'Pocitos', href: '/guides/montevideo/pocitos' },
    ])
  })

  it('ninguno llega al mínimo: vacío (la sección no se muestra)', () => {
    expect(cityNeighborhoods([guide('x', 'eat', { neighborhood: 'CORDON' }), guide('y', 'eat', { neighborhood: 'CORDON' })])).toEqual([])
  })

  it('ordena con tildes como en español (Ituzaingó entre Ituzaingo y Jacinto Vera)', () => {
    const three = (id: string) => ['1', '2', '3'].map((n) => guide(`${id}-${n}`, 'eat', { neighborhood: id }))
    const names = cityNeighborhoods([...three('JACINTO VERA'), ...three('ITUZAINGO'), ...three('AGUADA')]).map((entry) => entry.name)
    expect(names).toEqual(['Aguada', 'Ituzaingó', 'Jacinto Vera'])
  })
})
