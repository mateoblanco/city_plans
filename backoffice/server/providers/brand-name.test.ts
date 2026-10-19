import { describe, expect, it } from 'vitest'
import { brandFromGoogleName, brandSearchTerm, googleNameParts } from './brand-name.ts'

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
    'El Palenque',
    // Un guion sin espacios es parte del nombre.
    'Pan-Ka',
    'Coca-Cola',
    // Cortar dejaría menos de 3 caracteres o algo genérico.
    'Yu | Sushi bar',
    'Sushi - Pocitos',
    // Una comilla al principio no deja marca antes.
    '"La Pasiva"',
  ])('deja %s igual', (name) => {
    expect(brandFromGoogleName(name)).toBe(name)
  })

  it.each([
    ['The Lab Coffee Roasters | Museo Nacional de Artes Visuales', 'The Lab Coffee Roasters'],
    ['Café Misterio - Pocitos', 'Café Misterio'],
    ['La Pasiva (Tres Cruces)', 'La Pasiva'],
    ['Pancho Va! - Hot Dogs', 'Pancho Va!'],
    ['Oriundo – Café de especialidad', 'Oriundo'],
    ['Oriundo — Café de especialidad', 'Oriundo'],
    ['Oriundo · Café de especialidad', 'Oriundo'],
    ['Oriundo(Cordón)', 'Oriundo'],
    // Las comillas también cortan, con o sin espacio antes.
    ['Hakuna Matata "Pizza Cubana"', 'Hakuna Matata'],
    ['Hakuna Matata “Pizza Cubana”', 'Hakuna Matata'],
    ['Hakuna Matata «Pizza Cubana»', 'Hakuna Matata'],
    ['Hakuna Matata"Pizza Cubana"', 'Hakuna Matata'],
    // El primer separador gana.
    ['Gaboto Bar | Comidas - Tragos', 'Gaboto Bar'],
    // Después del corte siguen los sufijos de sucursal.
    ['Freddo Pocitos | Delivery', 'Freddo'],
  ])('corta %s en el primer separador', (name, brand) => {
    expect(brandFromGoogleName(name)).toBe(brand)
  })

  it('sólo una sucursal marca el lugar como sucursal, no un agregado descriptivo', () => {
    expect(googleNameParts('Freddo (Pocitos)')).toEqual({ brand: 'Freddo', branch: true })
    expect(googleNameParts('Freddo - Montevideo Shopping')).toEqual({ brand: 'Freddo', branch: true })
    expect(googleNameParts('La Nueva Roma Cordón')).toEqual({ brand: 'La Nueva Roma', branch: true })
    expect(googleNameParts('Freddo Pocitos | Delivery')).toEqual({ brand: 'Freddo', branch: true })
    expect(googleNameParts('The Lab Coffee Roasters | Museo Nacional de Artes Visuales')).toEqual({ brand: 'The Lab Coffee Roasters', branch: false })
    expect(googleNameParts('Pancho Va! - Hot Dogs')).toEqual({ brand: 'Pancho Va!', branch: false })
    expect(googleNameParts('El Palenque')).toEqual({ brand: 'El Palenque', branch: false })
    expect(googleNameParts('Hakuna Matata "Pizza Cubana"')).toEqual({ brand: 'Hakuna Matata', branch: false })
    expect(googleNameParts('Freddo "Pocitos"')).toEqual({ brand: 'Freddo', branch: true })
  })
})

describe('brandSearchTerm', () => {
  it('suma el tipo de lugar de Google a la marca, salvo que ya lo diga o sea genérico', () => {
    expect(brandSearchTerm('Musse', 'Restaurante')).toBe('Musse restaurante')
    expect(brandSearchTerm('Pizzeria Quinta', 'Pizzería')).toBe('Pizzeria Quinta')
    expect(brandSearchTerm('Café Nómade', 'Cafetería')).toBe('Café Nómade cafetería')
    expect(brandSearchTerm('Gaboto bar', 'Bar')).toBe('Gaboto bar')
    expect(brandSearchTerm('Oriundo', 'Establecimiento')).toBe('Oriundo')
    expect(brandSearchTerm('Oriundo', null)).toBe('Oriundo')
  })
})
