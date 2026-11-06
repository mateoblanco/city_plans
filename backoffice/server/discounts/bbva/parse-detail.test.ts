import { describe, expect, it } from 'vitest'
import { DiscountSourceError } from '../errors.ts'
import { BASE, fixture } from './fixtures.ts'
import { areaOf, extractCardProgram, instagramHandle, parseBbvaDetail, parseBenefitLine, parseLegalClause, splitTiers } from './parse-detail.ts'

const detail = (name: string) => parseBbvaDetail(fixture(`${name}.html`), `${BASE}gastronomia/${name}.html`)

describe('líneas de descuento', () => {
  it('lee porcentaje, tipo de tarjeta y niveles', () => {
    expect(parseBenefitLine('20% Off con Tarjetas de Débito')).toEqual({ text: '20% Off con Tarjetas de Débito', percent: 20, cardType: 'debit', cardTiers: [], cardProgram: null })
    expect(parseBenefitLine('30% Off con Tarjetas de Crédito Platinum, Black e Infinite')?.cardTiers).toEqual(['Platinum', 'Black', 'Infinite'])
    expect(splitTiers('Internacionales, Oro, Pymes y Corporativas')).toEqual(['Internacional', 'Oro', 'Pymes', 'Corporativa'])
    expect(parseBenefitLine('2x1 en postres')).toBeNull()
  })

  it('separa la tarjeta co-branded de los niveles', () => {
    expect(parseBenefitLine('20% Off con Tarjetas de Crédito Internacional, Oro BBVA Club Nacional de Football')).toMatchObject({
      cardTiers: ['Internacional', 'Oro'],
      cardProgram: 'Nacional',
    })
    expect(extractCardProgram('Platinum').cardProgram).toBeNull()
    // "Internacional" no es la tarjeta de Nacional.
    expect(extractCardProgram('Internacional, Oro').cardProgram).toBeNull()
  })
})

describe('legales', () => {
  it('mixto: parte en el punto de venta y el resto en el estado de cuenta, con tope', () => {
    expect(parseLegalClause('El descuento será de un 30%, se aplicará un 12% en el punto de venta, sin tope de devolución. El 18% restante se verá reflejado en el estado de cuenta, el tope de devolución será de 6000 pesos uruguayos por cierre de estado de cuenta. El descuento…', 'credit', [])).toMatchObject({
      percent: 30, instantPercent: 12, refundPercent: 18, cap: '6000 pesos uruguayos por cierre de estado de cuenta',
    })
  })

  it('sólo reintegro, con el tope cortado antes del plazo', () => {
    expect(parseLegalClause('El descuento será de un 20%, sobre el importe final de la factura, con tope de devolución de 4000 pesos uruguayos por cierre de estado de cuenta, en el cual se verá reflejado en un plazo máximo de 30 días.', 'debit', [])).toMatchObject({
      percent: 20, instantPercent: null, refundPercent: 20, cap: '4000 pesos uruguayos por cierre de estado de cuenta',
    })
  })

  it('todo en el punto de venta, sin porcentaje aparte: en el momento y sin tope', () => {
    expect(parseLegalClause('El descuento será de un 20%, se aplicará en el punto de venta, sin tope de devolución.', 'debit', [])).toMatchObject({
      percent: 20, instantPercent: 20, refundPercent: null, cap: 'Sin tope',
    })
  })

  it('"se aplicará punto de venta" (sin "en el")', () => {
    expect(parseLegalClause('El descuento será de un 20% se aplicará punto de venta, el tope de devolución será de 4000 pesos uruguayos.', 'credit', [])).toMatchObject({
      instantPercent: 20, refundPercent: null, cap: '4000 pesos uruguayos',
    })
  })

  it('reintegro sin tope: el "sin tope" de la frase del estado de cuenta', () => {
    expect(parseLegalClause('El descuento será de un 20%, se aplicará un 10% en el punto de venta. El 10% restante se verá reflejado en el estado de cuenta, sin tope de devolución por cierre de estado de cuenta.', 'debit', [])).toMatchObject({
      instantPercent: 10, refundPercent: 10, cap: 'Sin tope',
    })
    // El "sin tope" de la parte en el punto de venta no es el del reintegro.
    expect(parseLegalClause('El descuento será de un 20%, se aplicará un 10% en el punto de venta, sin tope de devolución. El 10% restante se verá reflejado en el estado de cuenta.', 'debit', []).cap).toBeNull()
  })

  it('porcentajes con coma', () => {
    expect(parseLegalClause('El descuento será de un 15%, se aplicará un 7,5% en el punto de venta, sin tope de devolución. El 7,5% restante se verá reflejado en el estado de cuenta.', 'debit', [])).toMatchObject({ instantPercent: 7.5, refundPercent: 7.5 })
  })
})

describe('parseBbvaDetail', () => {
  it('Porterhouse: beneficios, local con barrio, vigencia de la campaña y condiciones', () => {
    const porterhouse = detail('porterhouse')
    expect(porterhouse.name).toBe('Porterhouse')
    expect(porterhouse.subtitle).toBe('Carnicería en Pocitos, Montevideo')
    expect(porterhouse.lines.map((line) => [line.percent, line.cardType, line.cardTiers])).toEqual([
      [20, 'debit', []],
      [20, 'credit', ['Internacional', 'Oro', 'Pymes', 'Corporativa']],
      [30, 'credit', ['Platinum', 'Black', 'Infinite']],
    ])
    expect(porterhouse.locations).toEqual([expect.objectContaining({ address: 'José Ellauri 842, Pocitos', area: 'Pocitos' })])
    expect(porterhouse.legal).toMatchObject({ validFrom: '2026-11-01', validTo: '2027-10-31' })
    expect(porterhouse.legal!.clauses.map((clause) => [clause.cardType, clause.cardTiers, clause.instantPercent, clause.refundPercent])).toEqual([
      ['debit', [], 10, 10],
      ['credit', ['Internacional', 'Oro', 'Pymes', 'Corporativa'], 10, 10],
      ['credit', ['Infinite', 'Platinum', 'Black'], 10, 20],
    ])
    expect(porterhouse.legal!.conditions.join(' ')).toContain('no acumulable')
    expect(porterhouse.scope[0]).toContain('No aplica a las compras realizadas a través de Mercado Pago')
  })

  it('Nagasaki: web, Instagram y "Locales:"', () => {
    const nagasaki = detail('nagasaki')
    expect(nagasaki.website).toBe('https://nagasaki.com.uy/')
    expect(nagasaki.instagram).toBe('nagasakisushiuy')
    expect(nagasaki.locations[0]).toMatchObject({ area: 'Punta Carretas', mapsUrl: 'https://maps.app.goo.gl/C3StqVzhnNco1nec8' })
  })

  it('Up Lavista: dirección sin barrio ("esq") y vigencia con "setiembre"', () => {
    const up = detail('up-lavista')
    expect(up.locations[0]).toMatchObject({ area: null })
    expect(up.legal).toMatchObject({ validTo: '2027-09-30' })
  })

  it('Chelato: locales agrupados por departamento', () => {
    const chelato = detail('chelato')
    expect([...new Set(chelato.locations.map((location) => location.department))]).toEqual(['Montevideo', 'Canelones', 'Rocha'])
    expect(chelato.locations.filter((location) => location.department === 'Montevideo').map((location) => location.area)).toEqual(['Villa Muñoz', 'la Comercial'])
  })

  it('Grido: locales del acordeón (dirección | barrio), por departamento', () => {
    const grido = detail('grido')
    expect(grido.locations.length).toBeGreaterThan(50)
    expect(grido.locations[0]).toEqual({ address: 'Av. Libertador Lavalleja 2057', area: 'Aguada', department: 'Montevideo', mapsUrl: null })
  })

  it('Bocatti: acordeón con encabezado "Barrio | Dirección"', () => {
    const bocatti = detail('bocatti')
    expect(bocatti.locations[0]).toMatchObject({ address: 'Francisco Solano Lopez 1425', area: 'Malvín', department: 'Montevideo' })
    expect(bocatti.locations.some((location) => /direcci[oó]n/i.test(location.address))).toBe(false)
  })

  it('Amici: dirección en un párrafo, sin link de Maps válido', () => {
    expect(detail('amici').locations).toEqual([expect.objectContaining({ mapsUrl: null })])
    expect(detail('amici').locations[0].address).toMatch(/^Calle El madroño/)
  })

  it('Restaurante 1900: sólo tarjetas co-branded de Nacional', () => {
    const lines = detail('restaurante-1900').lines
    expect(lines.every((line) => line.cardProgram === 'Nacional')).toBe(true)
    expect(detail('restaurante-1900').locations[0].address).toMatch(/^General Urquiza/)
  })

  it('falla con un error claro si falta el bloque o la lista de descuentos', () => {
    expect(() => parseBbvaDetail('<h1 class="h1title__title">X</h1>', `${BASE}gastronomia/x.html`)).toThrow(DiscountSourceError)
    expect(() => parseBbvaDetail('<h1 class="h1title__title">X</h1><div class="promodetail__text"><p><b>Local:</b></p></div>', `${BASE}gastronomia/x.html`)).toThrow('no tiene la lista "Descuentos:"')
  })
})

describe('auxiliares', () => {
  it('handle de Instagram de un link o un @', () => {
    expect(instagramHandle('https://www.instagram.com/nagasakisushiuy/p/C8VTOLPqNQX/')).toBe('nagasakisushiuy')
    expect(instagramHandle('@Emporio.UY')).toBe('emporio.uy')
    expect(instagramHandle('https://www.instagram.com/p/abc')).toBeNull()
  })

  it('barrio y departamento de una dirección', () => {
    expect(areaOf('Chucarro 1210, Pocitos, Montevideo', null)).toEqual({ area: 'Pocitos', department: 'Montevideo' })
    expect(areaOf('Avenida Artigas 760 bis, Canelones', null)).toEqual({ area: 'Canelones', department: 'Canelones' })
    expect(areaOf('Rambla Tomás Berreta esq Ciruelo del Japón', null)).toEqual({ area: null, department: null })
    expect(areaOf('21 de Setiembre, 2890', null)).toEqual({ area: null, department: null })
  })
})
