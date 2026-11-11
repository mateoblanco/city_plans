import { describe, expect, it } from 'vitest'
import { extractPushBenefits } from './extract.ts'
import { fixture } from './fixtures.ts'
import { capsOf, decodeLegal, legalSections, legalToText, modeOf, montevideoSections } from './legal.ts'

describe('legal de Scotiabank', () => {
  it('el data-legal en base64 del DOM renderizado es el mismo legal del pushBenefit; el texto plano queda igual', () => {
    const html = fixture('beneficios-rendered')
    const encoded = [...html.matchAll(/data-legal="([A-Za-z0-9+/=]{16,})"/g)].map((match) => match[1])
    expect(encoded.length).toBeGreaterThan(0)
    const legals = new Set(extractPushBenefits(html).benefits.flatMap((benefit) => [benefit.legal, benefit.promo?.legal]))
    for (const value of encoded) expect(legals.has(decodeLegal(value))).toBe(true)
    expect(decodeLegal('El descuento se realiza al momento de la compra.')).toBe('El descuento se realiza al momento de la compra.')
    expect(decodeLegal('Tope')).toBe('Tope')
  })

  it('modalidad', () => {
    expect(modeOf('El descuento se realiza en el momento de la compra en el establecimiento.')).toBe('instant')
    expect(modeOf('El descuento se realiza al momento de la compra. Tope máximo de devolución de $12.500.')).toBe('instant')
    expect(modeOf('El descuento se realiza en el restaurante, tope de descuento por compra $1.500.')).toBe('instant')
    expect(modeOf('El descuento se realiza en el estado de cuenta.')).toBe('refund')
    expect(modeOf('Tope de compra $10.000')).toBe('unknown')
  })

  it('topes: de descuento con monto; de compra, de factura o sin decir de qué, sólo el texto; por nivel', () => {
    expect(capsOf('Todos los días 25%. Tope de descuento de $3.000 (pesos uruguayos tres mil) por compra. No aplica…').premium).toEqual({ text: 'Tope de descuento de $3.000 (pesos uruguayos tres mil) por compra.', amount: 3000, currency: 'UYU', period: 'purchase' })
    expect(capsOf('Tope de compra para obtener le descuento $ 15.000. El descuento…').premium).toEqual({ text: 'Tope de compra para obtener le descuento $ 15.000.', amount: null, currency: null, period: null })
    expect(capsOf('Tope de compra para efectuar el descuento USD 2.000 o su equivalente en pesos.').rest?.amount).toBeNull()
    expect(capsOf('Tope de $10.000 (pesos uruguayos diez mil) por compra.').premium?.amount).toBeNull()
    // Sin el punto antes del tope (Jacinto): el monto no sale del 25%.
    expect(capsOf('25% de descuento tarjetas Visa Débito Premium El descuento es otorgado en el momento Tope de descuento por compra $ 1.500. El beneficio…').premium).toMatchObject({ amount: 1500, currency: 'UYU' })
    const tiered = capsOf('El descuento se realiza en el estado de cuenta. Tope de devolución por compra para tarjetas Platinum, Infinite, Gold y Débito Premium $2500 y para tarjetas de crédito y débito clásicas $1500. Promoción…')
    expect([tiered.premium?.amount, tiered.rest?.amount, tiered.rest?.period]).toEqual([2500, 1500, 'purchase'])
    expect(capsOf('El descuento se realiza al momento.')).toEqual({ premium: null, rest: null })
  })

  it('bases por sucursal (La Pasiva): las de Montevideo', () => {
    const html = '<strong>La Pasiva, Piriápolis:</strong></br>El descuento se realiza en el estado de cuenta. Tope de descuento por mes y por cuenta de $5000.</br></br><strong>La Pasiva Prado, Montevideo:</strong></br>El descuento se realiza en el momento de la compra. Tope de $3.000 de descuento por compra.'
    const mvd = montevideoSections(legalSections(html))
    expect(mvd.map((section) => section.title)).toEqual(['La Pasiva Prado, Montevideo'])
    const text = mvd.map((section) => section.text).join('\n')
    expect(modeOf(text)).toBe('instant')
    expect(capsOf(text).premium).toMatchObject({ amount: 3000, period: 'purchase' })
    expect(legalToText('a<br>b<br/><b>c</b>')).toBe('a\nb\nc')
  })
})
