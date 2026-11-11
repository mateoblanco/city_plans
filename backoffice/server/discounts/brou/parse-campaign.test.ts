import { describe, expect, it } from 'vitest'
import { DiscountSourceError } from '../errors.ts'
import { CAMPAIGN, campaignHtml, PDF } from './fixtures.ts'
import { brouCardTiers, campaignMode, parseBenefitLine, parseBrouCampaign } from './parse-campaign.ts'

describe('página de la campaña de BROU', () => {
  it('la página real: link al PDF (sin nombre fijo), los tres beneficios, vigencia, reintegro y condiciones', () => {
    const campaign = parseBrouCampaign(campaignHtml(), CAMPAIGN)
    expect(campaign).toMatchObject({ title: 'Gastronomía Verano 2026-2027', pdfUrl: PDF, validFrom: '2026-11-01', validTo: '2027-02-28', mode: 'refund', pending: [], warnings: [] })
    const shape = campaign.benefits.map(({ percent, cardType, cardTiers, days, mode, refundPercent, instantPercent, cap }) => ({ percent, cardType, cardTiers, days, mode, refundPercent, instantPercent, cap }))
    expect(shape).toEqual([
      { percent: 30, cardType: 'credit', cardTiers: ['Visa Platinum', 'Visa Infinite', 'Mastercard Recompensa Platinum', 'Mastercard Recompensa Black'], days: 'all', mode: 'refund', refundPercent: 30, instantPercent: null, cap: { text: 'Tope mensual: $3.000 por cuenta', amount: 3000, currency: 'UYU', period: 'month' } },
      { percent: 20, cardType: 'credit', cardTiers: ['Visa Internacional', 'Visa Oro', 'Mastercard Recompensa Internacional', 'Mastercard Recompensa Oro'], days: 'all', mode: 'refund', refundPercent: 20, instantPercent: null, cap: { text: 'Tope mensual: $2.000 por cuenta', amount: 2000, currency: 'UYU', period: 'month' } },
      { percent: 10, cardType: 'debit', cardTiers: ['Visa', 'Mastercard Recompensa'], days: ['fri', 'sat', 'sun'], mode: 'refund', refundPercent: 10, instantPercent: null, cap: { text: 'Tope mensual: $2.000 por tarjeta', amount: 2000, currency: 'UYU', period: 'month' } },
    ])
    expect(campaign.benefits.every((benefit) => benefit.validFrom === '2026-11-01' && benefit.validTo === '2027-02-28' && benefit.parsedBy === 'html')).toBe(true)
    // Condiciones: el texto original, sin la vigencia, los beneficios ni la modalidad (ni la variante BROU A MANO).
    expect(campaign.conditions).toBe([
      'Valido en comercios gastronomicos adheridos, para compras presenciales mediante POS.',
      'El listado de comercios adheridos podrá modificarse durante la campana.',
      'Excepciones:',
      'Excluye tarjetas corporativas, prepagas, Mastercard Fiserv, RedBROU Maestro y débito Mastercard.',
      'No aplica a compras abonadas mediante plataformas de pago online como Mercado Pago, PedidosYa, Rappi o similares.',
      'No acumulable con otras promociones BROU vigentes.',
    ].join('\n'))
    expect(campaign.benefits[0].conditions).toBe(campaign.conditions)
    expect(campaign.text).toMatch(/^Del 1 de noviembre de 2026 al 28 de febrero de 2027/)
  })

  it('el link al PDF se toma de la página (otro nombre, relativo) y no de "También te puede interesar"', () => {
    const html = campaignHtml()
      .replace('https://beneficios.brou.com.uy/pdf/Listado%20GASTRONOMIA%206.11.26.pptx.pdf', '/pdf/Listado%20GASTRONOMIA%2020.12.26.pdf')
      .replace('<section class="cont-relacionados">', '<section class="cont-relacionados"><a href="/pdf/heladerias.pdf">Heladerías</a>')
    expect(parseBrouCampaign(html, CAMPAIGN).pdfUrl).toBe('https://beneficios.brou.com.uy/pdf/Listado%20GASTRONOMIA%2020.12.26.pdf')
  })

  it('sin link al PDF es un error del proveedor, no una lista vacía', () => {
    const html = campaignHtml().replace(/<a href="https:\/\/beneficios\.brou\.com\.uy\/pdf\/[^"]+"/, '<a href="https://beneficios.brou.com.uy/gastronomia"')
    expect(() => parseBrouCampaign(html, CAMPAIGN)).toThrow(DiscountSourceError)
    expect(() => parseBrouCampaign(html, CAMPAIGN)).toThrow(/no tiene el link al PDF/)
  })

  it('una línea de beneficio con otra forma no se adivina: va al modelo', () => {
    const html = campaignHtml().replace('Tope mensual: $2.000 por tarjeta. Aplica viernes, sábados y domingos.', 'Válido los fines de semana largos excepto feriados.')
    const campaign = parseBrouCampaign(html, CAMPAIGN)
    expect(campaign.benefits).toHaveLength(2)
    expect(campaign.pending).toEqual([expect.stringMatching(/^10% de descuento con tarjetas de débito/)])
  })
})

describe('reglas', () => {
  it('niveles por marca', () => {
    expect(brouCardTiers('BROU VISA Platinum e Infinite y BROU Recompensa Mastercard Platinum y Black')).toEqual(['Visa Platinum', 'Visa Infinite', 'Mastercard Recompensa Platinum', 'Mastercard Recompensa Black'])
    expect(brouCardTiers('BROU VISA y BROU Recompensa Mastercard')).toEqual(['Visa', 'Mastercard Recompensa'])
    expect(brouCardTiers('BROU OCA Blue')).toBeNull()
  })

  it('modalidad: estado de cuenta = reintegro; la variante de BROU A MANO no cuenta', () => {
    expect(campaignMode(['El descuento se acredita en la cuenta al cierre del estado de cuenta. Si se paga a traves de BROU A MANO Comercios, se realiza en la factura al momento de la compra.']).mode).toBe('refund')
    expect(campaignMode(['Si se paga a traves de BROU A MANO Comercios, se realiza en la factura al momento de la compra.']).mode).toBe('unknown')
  })

  it('línea de beneficio con modalidad en el momento', () => {
    expect(parseBenefitLine('15% de descuento con tarjetas de crédito BROU VISA Oro. Tope semanal: $500 por cuenta. Aplica de lunes a jueves.', 'instant')).toMatchObject({
      percent: 15, cardType: 'credit', cardTiers: ['Visa Oro'], days: ['mon', 'tue', 'wed', 'thu'], instantPercent: 15, refundPercent: null, cap: { amount: 500, period: 'week' },
    })
  })
})
