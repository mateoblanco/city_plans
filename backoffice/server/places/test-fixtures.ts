import type { PlaceEnrichmentDraft } from '../../src/types/places.ts'

// Place válido del pipeline para los tests de guardado.
export function draft(overrides: Partial<PlaceEnrichmentDraft> = {}): PlaceEnrichmentDraft {
  return {
    name: 'El Palenque',
    address: 'Pérez Castellano 1579',
    coordinates: { lat: -34.906, lng: -56.212, source: 'google', fetchedAt: '2026-10-12T20:00:00.000Z' },
    neighborhoodId: 'ciudad_vieja',
    city: 'Montevideo',
    googlePlaceId: 'place-1',
    transit: { status: 'success', lines: [{ line: '121', stopId: '42', meters: 150 }] },
    categories: ['grill'],
    tags: ['seafood'],
    dietary: { vegan: 'unknown', vegetarian: 'has_options', glutenFree: 'no' },
    price: 'high',
    reservations: 'accepts',
    hours: { raw: 'Todos los días 12 a 16', display: null, slots: [{ day: 1, opens: '12:00', closes: '16:00' }], status: 'exact', source: 'official', missingReason: null },
    contact: { phone: '2915 0000', whatsapp: null, instagram: 'elpalenque', website: 'https://elpalenque.example/', menuUrl: null, reservationUrl: 'https://meitre.com/palenque' },
    highlights: [{ es: 'Pulpo a la gallega', en: 'Galician octopus' }],
    dishes: ['pulpo a la gallega'],
    signature: ['seafood'],
    description: { es: 'Parrilla clásica.', en: 'Classic grill.' },
    locatedIn: 'Mercado del Puerto',
    placeFacts: [{ id: 'F1', text: 'Está en el Mercado del Puerto', kind: 'other', sourceId: 'S1', sourceUrl: 'https://guia.example/', trust: 'third_party', supports: ['locatedIn'] }],
    embeddingText: 'El Palenque. Ciudad Vieja, Montevideo. Dentro de Mercado del Puerto',
    keywordText: 'El Palenque. Ciudad Vieja. Mercado del Puerto. Parrilla',
    ...overrides,
  }
}
