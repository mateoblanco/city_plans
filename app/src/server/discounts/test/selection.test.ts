import { describe, expect, it } from 'vitest'
import { availableCards, cardProviders, choiceKey, matchesChoice, parseChoice, selectedProviders, type PlaceDiscount } from '../selection'

describe('parseChoice', () => {
  it('lee proveedor y tipo de tarjeta del catálogo (los ids con guion también)', () => {
    expect(parseChoice('itau.credit')).toEqual({ provider: 'itau', card: 'credit' })
    expect(parseChoice('itau-personal-bank.debit')).toEqual({ provider: 'itau-personal-bank', card: 'debit' })
    expect(choiceKey({ provider: 'bbva', card: 'debit' })).toBe('bbva.debit')
  })

  it('descarta proveedores o tipos que no existen; "other" no se elige', () => {
    for (const raw of ['nubank.credit', 'bbva.other', 'bbva', '.credit', 'bbva.', 'bbva.credit.x']) expect(parseChoice(raw)).toBeNull()
  })
})

describe('matchesChoice', () => {
  it('mismo proveedor y tipo; un beneficio "other" cumple débito y crédito', () => {
    expect(matchesChoice({ provider: 'itau', cardType: 'credit' }, { provider: 'itau', card: 'credit' })).toBe(true)
    expect(matchesChoice({ provider: 'itau', cardType: 'credit' }, { provider: 'itau', card: 'debit' })).toBe(false)
    expect(matchesChoice({ provider: 'itau', cardType: 'credit' }, { provider: 'bbva', card: 'credit' })).toBe(false)
    expect(matchesChoice({ provider: 'santander', cardType: 'other' }, { provider: 'santander', card: 'debit' })).toBe(true)
    expect(matchesChoice({ provider: 'santander', cardType: 'other' }, { provider: 'santander', card: 'credit' })).toBe(true)
    expect(matchesChoice({ provider: 'santander', cardType: 'other' }, { provider: 'bbva', card: 'credit' })).toBe(false)
  })
})

describe('cardProviders', () => {
  const discounts: PlaceDiscount[] = [
    { provider: 'santander', cardType: 'credit' },
    { provider: 'bbva', cardType: 'debit' },
    { provider: 'itau', cardType: 'credit' },
    { provider: 'bbva', cardType: 'credit' },
  ]

  it('sin filtro: todos los proveedores del lugar, sin repetir y en el orden de la config', () => {
    expect(cardProviders(discounts, [])).toEqual([{ id: 'itau', name: 'Itaú' }, { id: 'santander', name: 'Santander' }, { id: 'bbva', name: 'BBVA' }])
    expect(cardProviders([], [])).toEqual([])
  })

  it('con filtro: sólo los que cumplen alguna elección', () => {
    expect(cardProviders(discounts, [{ provider: 'bbva', card: 'debit' }])).toEqual([{ id: 'bbva', name: 'BBVA' }])
    expect(cardProviders(discounts, [{ provider: 'itau', card: 'debit' }])).toEqual([])
    expect(cardProviders(discounts, [{ provider: 'santander', card: 'credit' }, { provider: 'itau', card: 'credit' }])).toEqual([{ id: 'itau', name: 'Itaú' }, { id: 'santander', name: 'Santander' }])
  })
})

describe('selectedProviders', () => {
  it('sin repetir y en el orden de la config', () => {
    expect(selectedProviders([{ provider: 'bbva', card: 'debit' }, { provider: 'itau', card: 'credit' }, { provider: 'bbva', card: 'credit' }])).toEqual(['itau', 'bbva'])
  })
})

describe('availableCards', () => {
  it('sólo los tipos con algún beneficio; "other" cuenta como débito y crédito', () => {
    expect(availableCards(['credit'])).toEqual(['credit'])
    expect(availableCards(['debit', 'credit'])).toEqual(['debit', 'credit'])
    expect(availableCards(['other'])).toEqual(['debit', 'credit'])
    expect(availableCards(['credit', 'other'])).toEqual(['debit', 'credit'])
    expect(availableCards([])).toEqual([])
  })

  it('un tipo elegido en la URL sigue teniendo chip aunque ya no tenga beneficios (para poder sacarlo)', () => {
    expect(availableCards(['credit'], ['debit'])).toEqual(['debit', 'credit'])
  })
})
