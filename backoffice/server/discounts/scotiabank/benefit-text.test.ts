import { describe, expect, it } from 'vitest'
import { parseScotiaCards, parseScotiaLine, percentClauses } from './benefit-text.ts'

const credit = (...cardTiers: string[]) => ({ cardType: 'credit', cardTiers })
const debit = (...cardTiers: string[]) => ({ cardType: 'debit', cardTiers })

describe('texto de tarjetas de Scotiabank', () => {
  it('las variantes de la página', () => {
    const premium = [credit('Platinum', 'Infinite', 'Gold'), debit('Premium')]
    for (const text of [
      'con tarjetas de Crédito Platinum, Infinite, Gold y Débito Premium.',
      ' con tarjetas Platinum, Infinite, Gold y débito Premium.',
      'con Tarjetas Platinum, Infinite, Gold y Débito Premium.',
      'con tarjetas de crédito Platinum, Infinite, Gold y Débito Premium /',
      'con Tarjetas de Crédito Platinum, Infinite, Gold y Débito Premium',
    ]) expect(parseScotiaCards(text)).toEqual(premium)
    for (const text of ['con tarjetas de Crédito y Débito.', 'tarjetas de crédito y débito', 'con Tarjetas de Crédito y Débito.']) expect(parseScotiaCards(text)).toEqual([credit(), debit()])
    expect(parseScotiaCards('con tarjetas de crédito y débito Clásicas.')).toEqual([credit('Clásica'), debit('Clásica')])
    expect(parseScotiaCards('con tarjetas de crédito Platinum, Infinite, Gold.')).toEqual([credit('Platinum', 'Infinite', 'Gold')])
    expect(parseScotiaCards('con tarjetas de crédito Scotiabank.')).toEqual([credit()])
    // Sin débito si el texto no lo dice.
    expect(parseScotiaCards('con Tarjetas de Crédito.')).toEqual([credit()])
  })

  it('lo ambiguo no se lee con reglas (va al modelo)', () => {
    expect(parseScotiaCards('con tarjetas de crédito y débito Premium.')).toBeNull()
    expect(parseScotiaCards('con Tarjetas de Débito y Crédito Premium.')).toBeNull()
    expect(parseScotiaLine('25% y 15% de ahorro ', 'con tarjetas de crédito y débito en sus restaurantes, **Punta Carretas Shopping, Mercado Agrícola y Punta Shopping**.')).toBeNull()
  })

  it('el porcentaje, también con "Hasta"', () => {
    expect(parseScotiaLine('Hasta 25% de ahorro', ' con tarjetas de Crédito Platinum, Infinite, Gold y Débito Premium.')?.percent).toBe(25)
    expect(parseScotiaLine('15% de ahorro ', 'con tarjetas de Crédito y Débito.')).toEqual({ percent: 15, cards: [credit(), debit()] })
  })

  it('una frase de las bases con dos porcentajes, en dos cláusulas', () => {
    expect(percentClauses('Todos los días 25% de descuento con tarjetas de Crédito Platinum, Infinite, Gold y Débito Premium y 15% de descuento con tarjetas de crédito y débito Scotiabank.')).toEqual([
      { pct: '25% de descuento', texto: 'con tarjetas de Crédito Platinum, Infinite, Gold y Débito Premium' },
      { pct: '15% de descuento', texto: 'con tarjetas de crédito y débito Scotiabank.' },
    ])
  })
})
