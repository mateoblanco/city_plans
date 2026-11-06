import { describe, expect, it } from 'vitest'
import { mentionsDebit, parseSantanderBenefitText } from './benefit-text.ts'

const shape = (text: string) => parseSantanderBenefitText(text).benefits.map(({ percent, cardType, cardTiers, days }) => ({ percent, cardType, cardTiers, days }))

describe('texto de beneficio de Santander', () => {
  it('el texto estándar: Platinum es crédito; "crédito y débito" son dos; la línea de IVA no es un beneficio', () => {
    const result = parseSantanderBenefitText('25% con Platinum, Select y Private Banking.\n15% con crédito y débito.\nA los descuentos se suma la devolución de puntos de IVA.')
    expect(shape('25% con Platinum, Select y Private Banking.\n15% con crédito y débito.')).toEqual([
      { percent: 25, cardType: 'credit', cardTiers: ['Platinum', 'Select', 'Private Banking'], days: 'all' },
      { percent: 15, cardType: 'credit', cardTiers: [], days: 'all' },
      { percent: 15, cardType: 'debit', cardTiers: [], days: 'all' },
    ])
    expect(result.ignored).toEqual(['A los descuentos se suma la devolución de puntos de IVA.'])
    expect(result.pending).toEqual([])
  })

  it('"15% de descuento todos los días": sin tipo de tarjeta (no se inventa un débito), todos los días', () => {
    expect(parseSantanderBenefitText('15% de descuento todos los días.').benefits).toEqual([
      { percent: 15, cardType: 'other', cardTiers: [], days: 'all', daysText: 'todos los días', sourceText: '15% de descuento todos los días.' },
    ])
  })

  it('"débito Select" es débito con nivel Select; varios porcentajes en una oración', () => {
    expect(shape('50% de descuento con tarjeta Infinite, Black y débito Select, 30%  de crédito y débito')).toEqual([
      { percent: 50, cardType: 'debit', cardTiers: ['Select'], days: 'all' },
      { percent: 50, cardType: 'credit', cardTiers: ['Infinite', 'Black'], days: 'all' },
      { percent: 30, cardType: 'credit', cardTiers: [], days: 'all' },
      { percent: 30, cardType: 'debit', cardTiers: [], days: 'all' },
    ])
  })

  it('"tarjetas select" sin tipo: sin especificar; "tarjetas de crédito": crédito', () => {
    expect(shape('25% con tarjetas select y 15% de descuento con tarjetas de crédito')).toEqual([
      { percent: 25, cardType: 'other', cardTiers: ['Select'], days: 'all' },
      { percent: 15, cardType: 'credit', cardTiers: [], days: 'all' },
    ])
  })

  it('días concretos', () => {
    expect(shape('20% con crédito de lunes a jueves.')).toEqual([{ percent: 20, cardType: 'credit', cardTiers: [], days: ['mon', 'tue', 'wed', 'thu'] }])
  })

  it('canje de puntos: no es un beneficio, pero se marca', () => {
    expect(parseSantanderBenefitText('El comercio acepta canje de puntos Soy Santander.')).toEqual({
      benefits: [], pending: [], ignored: ['El comercio acepta canje de puntos Soy Santander.'], points: true,
    })
  })

  it('una palabra que no conozco manda la oración al modelo', () => {
    expect(parseSantanderBenefitText('20% los martes con Visa Santander. 15% con crédito.')).toMatchObject({
      pending: ['20% los martes con Visa Santander.'],
      benefits: [expect.objectContaining({ percent: 15, cardType: 'credit' })],
    })
  })

  it('mentionsDebit', () => {
    expect(mentionsDebit('30% de crédito y débito')).toBe(true)
    expect(mentionsDebit('25% con tarjetas Select')).toBe(false)
  })
})
