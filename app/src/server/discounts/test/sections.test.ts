import { describe, expect, it } from 'vitest'
import { DISCOUNTS_CONFIG } from '../config'
import { discountSections } from '../sections'
import type { PlaceDiscount } from '../selection'

const place = (id: string, ...discounts: PlaceDiscount[]) => ({ id, discounts })

describe('discountSections', () => {
  const items = [
    place('a', { provider: 'bbva', cardType: 'debit' }, { provider: 'itau', cardType: 'credit' }),
    place('b', { provider: 'itau', cardType: 'credit' }),
    place('c', { provider: 'bbva', cardType: 'credit' }),
    place('d', { provider: 'bbva', cardType: 'other' }),
  ]

  it('con un solo proveedor (aunque sean los dos tipos) no agrupa: los grupos de siempre', () => {
    expect(discountSections(items, [])).toBeNull()
    expect(discountSections(items, [{ provider: 'bbva', card: 'debit' }, { provider: 'bbva', card: 'credit' }])).toBeNull()
  })

  it('con dos proveedores: un grupo por proveedor en el orden de la config, y un lugar con los dos va en ambos', () => {
    const sections = discountSections(items, [{ provider: 'bbva', card: 'debit' }, { provider: 'itau', card: 'credit' }])
    expect(sections).toEqual([
      { id: 'discount:itau', title: 'Con descuento Itaú', placeIds: ['a', 'b'], total: 2 },
      // c es crédito y no entra con débito; d es "other" y sí.
      { id: 'discount:bbva', title: 'Con descuento BBVA', placeIds: ['a', 'd'], total: 2 },
    ])
  })

  it('cada grupo hasta groupMax en orden de ranking, con el total para "Ver todos"; sin lugares, no sale', () => {
    const many = Array.from({ length: DISCOUNTS_CONFIG.groupMax + 2 }, (_, index) => place(`p${index}`, { provider: 'itau', cardType: 'credit' }))
    const sections = discountSections(many, [{ provider: 'itau', card: 'credit' }, { provider: 'santander', card: 'debit' }])
    expect(sections).toEqual([
      { id: 'discount:itau', title: 'Con descuento Itaú', placeIds: many.slice(0, DISCOUNTS_CONFIG.groupMax).map((item) => item.id), total: many.length },
    ])
    expect(discountSections([], [{ provider: 'itau', card: 'credit' }, { provider: 'bbva', card: 'debit' }])).toBeNull()
  })
})
