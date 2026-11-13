import { describe, expect, it } from 'vitest'
import { discardReason } from './discard.ts'
import { autoDiscardCategories } from './providers.ts'

const rules = autoDiscardCategories()

describe('discardReason', () => {
  it('los rubros reales que no son para salir a comer o tomar algo', () => {
    expect(discardReason('Carnicería', rules)).toBe('Rubro: Carnicería')
    expect(discardReason('Carnicería en Pocitos, Montevideo', rules)).toBe('Rubro: Carnicería')
    expect(discardReason('Boutique de carnes', rules)).toBe('Rubro: Boutique de carnes')
    expect(discardReason('Boutique de carne', rules)).toBe('Rubro: Boutique de carne')
    expect(discardReason('Tienda de Carnes, Maldonado', rules)).toBe('Rubro: Tienda de carnes')
    expect(discardReason('Importación, distribución y venta de productos congelados', rules)).toBe('Rubro: Productos congelados')
    expect(discardReason('SUPERMERCADO', rules)).toBe('Rubro: Supermercado')
    expect(discardReason('Almacen de barrio', rules)).toBe('Rubro: Almacén')
  })

  it('palabras completas: "carne" no es "carnes" ni "carnicería" un pedazo de otra palabra', () => {
    expect(discardReason('Restaurante de carnes a la parrilla', ['Carne'])).toBeNull()
    expect(discardReason('Almacenes generales', rules)).toBeNull()
  })

  it('no descarta si el rubro también dice algo gastronómico', () => {
    expect(discardReason('Vinería y restaurante', ['Vinería'])).toBeNull()
    expect(discardReason('librerias, cafeteria', ['Librerías'])).toBeNull()
    expect(discardReason('Carnicería y parrilla', rules)).toBeNull()
    expect(discardReason('Almacén y bar', rules)).toBeNull()
  })

  it('sin rubro o sin lista, nada', () => {
    expect(discardReason(null, rules)).toBeNull()
    expect(discardReason('Carnicería', [])).toBeNull()
    expect(discardReason('Restaurante', rules)).toBeNull()
    expect(discardReason('Cafetería', rules)).toBeNull()
  })
})
