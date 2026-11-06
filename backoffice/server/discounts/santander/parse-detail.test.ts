import { describe, expect, it } from 'vitest'
import { DiscountSourceError } from '../errors.ts'
import { capOfConditions, coordinatesOf, parseSantanderDetail } from './parse-detail.ts'
import { DETAIL, fixture } from './fixtures.ts'

const detail = (name: string) => parseSantanderDetail(fixture(`${name}.html`), `${DETAIL}${name}`)

describe('parseSantanderDetail', () => {
  it('Almar: reintegro en el estado de cuenta, tope por segmento (sin monto), un local con coordenadas', () => {
    const almar = detail('almar')
    expect(almar.name).toBe('Almar')
    expect(almar.mode).toBe('refund')
    expect(almar.cap).toEqual({ text: 'Private Banking hasta UYU 6.000, Select UYU 4.000, resto UYU 2.000 por mes (crédito y débito por separado)', amount: null, currency: 'UYU', period: 'month' })
    expect(almar.conditions.join(' ')).toContain('no acumulable')
    expect(almar.locations).toEqual([expect.objectContaining({ address: 'Rambla República de México 5535', coordinates: expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) }) })])
  })

  it('Cali Café: sin bullets, en el punto de venta; un local en La Barra y otro en Montevideo', () => {
    const cali = detail('cali-cafe')
    expect(cali.mode).toBe('instant')
    expect(cali.cap).toBeNull()
    expect(cali.locations).toHaveLength(2)
    expect(cali.locations[1]).toMatchObject({ address: 'Claudio Williman 642', coordinates: { lat: -34.916854, lng: -56.1587053 } })
  })

  it('La Pasiva Arocena: la presentación va aparte de las condiciones (sus "lunes a viernes" no son días del descuento)', () => {
    const pasiva = detail('la-pasiva-arocena')
    expect(pasiva.description).toContain('menú ejecutivo de lunes a viernes')
    expect(pasiva.conditions.join(' ')).not.toContain('menú ejecutivo')
  })

  it('Medialunas Calentitas: 10 locales, la dirección sin el teléfono', () => {
    const medialunas = detail('medialunas-calentitas')
    expect(medialunas.locations).toHaveLength(10)
    expect(medialunas.locations.every((location) => location.coordinates)).toBe(true)
    expect(medialunas.locations.some((location) => /\d{4} \d{2} \d{2}$/.test(location.address))).toBe(false)
  })

  it('falla con un error claro en una página sin el artículo (la de error 503)', () => {
    expect(() => parseSantanderDetail(fixture('error-503.html'), `${DETAIL}nora-rey`)).toThrow(DiscountSourceError)
  })
})

describe('auxiliares', () => {
  it('coordenadas del link a Maps', () => {
    expect(coordinatesOf('https://www.google.com/maps/dir//-34.910066,-56.1498038')).toEqual({ lat: -34.910066, lng: -56.1498038 })
    expect(coordinatesOf('https://goo.gl/maps/abc')).toBeNull()
    expect(coordinatesOf(undefined)).toBeNull()
  })

  it('tope con un solo monto', () => {
    expect(capOfConditions(['Tope de devolución mensual: hasta UYU 3.000 por cliente.'])).toMatchObject({ amount: 3000, currency: 'UYU', period: 'month' })
    expect(capOfConditions(['Descuento no acumulable.'])).toBeNull()
  })
})
