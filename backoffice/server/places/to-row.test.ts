import { describe, expect, it } from 'vitest'
import { draft } from './test-fixtures.ts'
import { toRow } from './to-row.ts'

describe('toRow', () => {
  it('convierte el place del pipeline en una fila de places sin placeFacts', () => {
    const row = toRow({ ...draft(), neighborhoodId: 'ciudad_vieja' })

    expect(row).toEqual({
      googlePlaceId: 'place-1',
      name: 'El Palenque',
      address: 'Pérez Castellano 1579',
      locatedIn: 'Mercado del Puerto',
      neighborhoodId: 'ciudad_vieja',
      city: 'Montevideo',
      location: { lng: -56.212, lat: -34.906 },
      coordinatesSource: 'google',
      coordinatesFetchedAt: new Date('2026-10-12T20:00:00.000Z'),
      categories: ['grill'],
      tags: ['seafood'],
      signature: ['seafood'],
      dishes: ['pulpo a la gallega'],
      dietVegan: 'unknown',
      dietVegetarian: 'has_options',
      dietGlutenFree: 'no',
      price: 'high',
      reservations: 'accepts',
      hours: draft().hours,
      phone: '2915 0000',
      whatsapp: null,
      instagram: 'elpalenque',
      website: 'https://elpalenque.example/',
      menuUrl: null,
      reservationUrl: 'https://meitre.com/palenque',
      descriptionEs: 'Parrilla clásica.',
      descriptionEn: 'Classic grill.',
      highlights: [{ es: 'Pulpo a la gallega', en: 'Galician octopus' }],
      transitLines: [{ line: '121', stopId: '42', meters: 150 }],
      embeddingText: 'El Palenque. Ciudad Vieja, Montevideo. Dentro de Mercado del Puerto',
      keywordText: 'El Palenque. Ciudad Vieja. Mercado del Puerto. Parrilla',
    })
    expect(row).not.toHaveProperty('placeFacts')
  })

  it('convierte los textos vacíos en null', () => {
    const row = toRow({
      ...draft({ address: '', locatedIn: '  ', contact: { phone: '', whatsapp: null, instagram: ' ', website: '', menuUrl: '', reservationUrl: '' }, description: { es: '', en: '' }, embeddingText: '', keywordText: '' }),
      neighborhoodId: 'ciudad_vieja',
    })

    expect(row).toMatchObject({
      address: null, locatedIn: null, phone: null, whatsapp: null, instagram: null, website: null, menuUrl: null, reservationUrl: null,
      descriptionEs: null, descriptionEn: null, embeddingText: null, keywordText: null,
    })
    expect(toRow({ ...draft({ address: null }), neighborhoodId: 'ciudad_vieja' }).address).toBeNull()
  })

  it('sin nombre falla con un error claro', () => {
    expect(() => toRow({ ...draft({ name: '  ' }), neighborhoodId: 'ciudad_vieja' })).toThrow('Sin nombre: ninguna fuente confirma el nombre')
  })
})
