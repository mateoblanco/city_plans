import { describe, expect, it } from 'vitest'
import { groupBenefits } from '../benefits'
import type { BenefitRow } from '../queries'

const benefit = (overrides: Partial<BenefitRow> & { id: string; providerId: string }): BenefitRow => ({
  percent: 20,
  cardType: 'credit',
  cardTiers: [],
  cardProgram: null,
  daysKind: 'all',
  days: [],
  daysText: null,
  mode: 'instant',
  instantPercent: 20,
  refundPercent: null,
  capText: null,
  capAmount: null,
  capCurrency: null,
  capPeriod: null,
  conditions: null,
  sourceUrl: null,
  ...overrides,
})

describe('groupBenefits', () => {
  it('por proveedor en el orden de la config; débito, crédito sin nivel, con nivel y otra', () => {
    const groups = groupBenefits([
      benefit({ id: 'b1', providerId: 'bbva', cardType: 'credit', cardTiers: ['Platinum'] }),
      benefit({ id: 'i1', providerId: 'itau', percent: 20, cardTiers: ['Platinum'] }),
      benefit({ id: 'b2', providerId: 'bbva', cardType: 'other' }),
      benefit({ id: 'b3', providerId: 'bbva', cardType: 'debit' }),
      benefit({ id: 'i2', providerId: 'itau', percent: 15 }),
      benefit({ id: 'b4', providerId: 'bbva', cardType: 'credit' }),
    ])
    expect(groups.map((group) => [group.id, group.name, group.benefits.map((item) => item.id)])).toEqual([
      ['itau', 'Itaú', ['i2', 'i1']],
      ['bbva', 'BBVA', ['b3', 'b4', 'b1', 'b2']],
    ])
  })

  it('arma días y tope del formato común', () => {
    const [group] = groupBenefits([
      benefit({ id: 'a', providerId: 'santander', daysKind: 'list', days: ['mon', 'wed'], capText: 'UYU 2.000 por mes', capAmount: 2000, capCurrency: 'UYU', capPeriod: 'month' }),
      benefit({ id: 'b', providerId: 'santander', cardType: 'debit', daysKind: 'unknown', daysText: 'feriados' }),
    ])
    const [debit, credit] = group.benefits
    expect(debit.days).toBeNull()
    expect(debit.daysText).toBe('feriados')
    expect(credit.days).toEqual(['mon', 'wed'])
    expect(credit.cap).toEqual({ text: 'UYU 2.000 por mes', amount: 2000, currency: 'UYU', period: 'month' })
  })
})
