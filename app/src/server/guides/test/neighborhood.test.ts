import { describe, expect, it } from 'vitest'
import { groupGuides } from '../neighborhood'
import type { GuidePlaceRow } from '../places'
import type { Guide, GuideGroup } from '../types'

const row = (id: string): GuidePlaceRow => ({
  id,
  slug: id,
  name: id.toUpperCase(),
  neighborhoodId: 'CORDON',
  categories: ['cafe'],
  iconCategory: null,
  logoKey: `${id}.webp`,
  logoBgColor: null,
  lat: -34.9,
  lng: -56.17,
})

const guide = (slug: string, group: GuideGroup, ids: string[]): Guide => ({
  id: slug,
  featured: false,
  color: '#FF8E00',
  draft: false,
  live: true,
  publishedPlaces: 1,
  slug,
  city: 'montevideo',
  neighborhood: 'CORDON',
  group,
  title: `Guía ${slug}`,
  seoTitle: slug,
  seoDescription: slug,
  intro: [],
  updatedAt: '2026-11-19',
  places: ids.map((id) => ({ id, text: `Texto de ${id}` })),
})

const logoUrl = (key: string | null) => (key ? `https://logos/${key}` : null)
const rows = ['a', 'b', 'c', 'd', 'e'].map(row)

describe('filas de la página del barrio', () => {
  it('los grupos en el orden de la app (Comer, Tomar algo, Cafés, Postres), no el del archivo', () => {
    const groups = groupGuides([guide('dulces', 'desserts', ['a']), guide('cafes', 'cafes', ['b']), guide('comer', 'eat', ['c'])], rows, logoUrl)
    expect(groups.map((group) => [group.group, group.title])).toEqual([
      ['eat', 'Comer'],
      ['cafes', 'Cafés'],
      ['desserts', 'Postres'],
    ])
  })

  it('un grupo sin guías no se muestra (acá, Tomar algo)', () => {
    const groups = groupGuides([guide('cafes', 'cafes', ['a'])], rows, logoUrl)
    expect(groups.map((group) => group.group)).toEqual(['cafes'])
  })

  it('una guía sin lugares publicados no sale, y si era la única de su grupo, el grupo tampoco', () => {
    const groups = groupGuides([guide('vacia', 'bars', ['zz']), guide('cafes', 'cafes', ['a'])], rows, logoUrl)
    expect(groups.map((group) => group.group)).toEqual(['cafes'])
  })

  it('tarjeta: link, cantidad de publicados y los logos de los 3 primeros publicados', () => {
    const [cafes] = groupGuides([guide('cafes', 'cafes', ['a', 'zz', 'b', 'c', 'd'])], rows, logoUrl)
    const [card] = cafes.guides
    expect(card.href).toBe('/guides/montevideo/cafes')
    expect(card.neighborhood).toBe('Cordón')
    expect(card.count).toBe(4)
    expect(card.logos.map((logo) => [logo.id, logo.logoUrl])).toEqual([
      ['a', 'https://logos/a.webp'],
      ['b', 'https://logos/b.webp'],
      ['c', 'https://logos/c.webp'],
    ])
    expect(card.cover).toBeNull()
  })

  it('dos guías del mismo grupo van en el orden del archivo', () => {
    const [cafes] = groupGuides([guide('uno', 'cafes', ['a']), guide('dos', 'cafes', ['b'])], rows, logoUrl)
    expect(cafes.guides.map((card) => card.slug)).toEqual(['uno', 'dos'])
  })
})
