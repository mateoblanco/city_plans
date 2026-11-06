import { describe, expect, it } from 'vitest'
import type { DiscountBenefit } from '@/types/discounts'
import { benefitSummary, capLabel, daysLabel, modeLabel, validityLabel } from './discounts'

const benefit = (patch: Partial<DiscountBenefit>): DiscountBenefit => ({
  id: 'b', percent: 20, cardType: 'debit', cardTiers: [], cardProgram: null, days: 'all', daysText: null, mode: 'mixed', instantPercent: 10, refundPercent: 10,
  cap: null, validFrom: null, validTo: null, conditions: null, sourceText: '', sourceUrl: null, parsedBy: 'html', ...patch,
})

describe('presentación de descuentos', () => {
  it('resume por tipo de tarjeta con rangos', () => {
    expect(benefitSummary([benefit({}), benefit({ cardType: 'credit' }), benefit({ cardType: 'credit', percent: 30 })])).toBe('Débito 20% · Crédito 20–30%')
    expect(benefitSummary([benefit({ cardType: 'credit', cardProgram: 'Nacional', percent: 7.5 })])).toBe('Crédito Nacional 7,5%')
  })

  it('días, modalidad y vigencia', () => {
    expect(daysLabel('all')).toBe('Todos los días')
    expect(daysLabel(null)).toBe('No se pudo determinar')
    expect(daysLabel(['tue', 'thu'])).toBe('Mar, Jue')
    expect(modeLabel(benefit({ instantPercent: 7.5, refundPercent: 7.5 }))).toBe('Mixto: 7,5% en el momento + 7,5% de reintegro')
    expect(modeLabel(benefit({ mode: 'refund' }))).toBe('Reintegro')
    expect(validityLabel(null, null)).toBe('—')
    expect(validityLabel(null, '2027-10-31')).toMatch(/^hasta 31/)
    expect(capLabel({ text: '4000 pesos uruguayos por cierre', amount: 4000, currency: 'UYU', period: 'statement' })).toBe('4.000 UYU por cierre')
    expect(capLabel({ text: 'Sin tope', amount: null, currency: null, period: null })).toBe('Sin tope')
    expect(capLabel(null)).toBe('—')
  })
})
