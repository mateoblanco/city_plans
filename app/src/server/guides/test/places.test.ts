import { describe, expect, it } from 'vitest'
import { assembleGuidePlaces, type GuidePlaceRow } from '../places'

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

const entries = ['a', 'b', 'c'].map((id) => ({ id, text: `Texto de ${id}` }))

describe('assembleGuidePlaces', () => {
  it('respeta el orden del archivo, no el de la base', () => {
    const places = assembleGuidePlaces(entries, [row('c'), row('a'), row('b')])
    expect(places.map((place) => [place.number, place.row.id, place.text])).toEqual([
      [1, 'a', 'Texto de a'],
      [2, 'b', 'Texto de b'],
      [3, 'c', 'Texto de c'],
    ])
  })

  it('un lugar que no volvió (despublicado o borrado) se saltea sin error y la numeración se recalcula', () => {
    const places = assembleGuidePlaces(entries, [row('a'), row('c')])
    expect(places.map((place) => [place.number, place.row.id])).toEqual([
      [1, 'a'],
      [2, 'c'],
    ])
  })

  it('un id repetido en el archivo sale una sola vez; sin foto, null', () => {
    const places = assembleGuidePlaces([...entries, { id: 'a', text: 'otra vez' }], [row('a'), row('b'), row('c')])
    expect(places).toHaveLength(3)
    expect(places[0].photo).toBeNull()
  })

  it('sin ninguno publicado, lista vacía', () => {
    expect(assembleGuidePlaces(entries, [])).toEqual([])
  })
})
