import { describe, expect, it } from 'vitest'
import { brandFromGoogleName } from './brand-name.ts'

describe('brandFromGoogleName', () => {
  it.each([
    ['La Nueva Roma Cordón', 'La Nueva Roma'],
    ['Freddo', 'Freddo'],
    ['Freddo - Montevideo Shopping', 'Freddo'],
    ['Freddo (Pocitos)', 'Freddo'],
    ['Freddo Sucursal Avenida Italia', 'Freddo'],
    ['La Pasiva Centro', 'La Pasiva'],
    ['Chivitería Marcos Local 12', 'Chivitería Marcos'],
    ['Tienda Inglesa Punta Carretas Shopping', 'Tienda Inglesa'],
  ])('saca la sucursal de %s', (name, brand) => {
    expect(brandFromGoogleName(name)).toBe(brand)
  })

  it.each([
    // Lo que queda sería una sola palabra genérica de tags.ts.
    'Sushi Pocitos',
    'Parrilla Malvín',
    'Pizzería Cordón',
    // Lo que queda terminaría en preposición o artículo.
    'Café del Prado',
    // El segmento después del guion no es una sucursal.
    'Pancho Va! - Hot Dogs',
    'El Palenque',
  ])('deja %s igual', (name) => {
    expect(brandFromGoogleName(name)).toBe(name)
  })
})
