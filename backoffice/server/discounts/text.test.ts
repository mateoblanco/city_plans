import { describe, expect, it } from 'vitest'
import { parseCap, parseDays, spanishDates, validityRange } from './text.ts'

describe('fechas en español', () => {
  it('lee "del X al Y" con "setiembre", "desde el" y mayúsculas', () => {
    expect(validityRange('Promoción válida del 01 de octubre de 2026 al 30 de setiembre de 2027 para clientes')).toEqual({ validFrom: '2026-10-01', validTo: '2027-09-30' })
    expect(validityRange('Promoción válida desde el 01 de Agosto de 2026 al 31 de julio de 2027')).toEqual({ validFrom: '2026-08-01', validTo: '2027-07-31' })
    expect(validityRange('Promoción válida del 22 de mayo de 2026 al 31de mayo de 2027')).toEqual({ validFrom: '2026-05-22', validTo: '2027-05-31' })
    expect(validityRange('Sin fechas')).toBeNull()
  })

  it('lee fechas sueltas, con o sin "de" antes del año', () => {
    expect(spanishDates('Vigencia: 31 de Octubre 2027')).toEqual(['2027-10-31'])
    expect(spanishDates('31 de febrero de 2027')).toEqual([])
  })
})

describe('parseDays', () => {
  it("sin mención de días es 'all'", () => {
    expect(parseDays('20% Off con Tarjetas de Débito. No acumulable.')).toEqual({ days: 'all', daysText: null })
  })

  it("'todos los días' es 'all' con el texto", () => {
    expect(parseDays('Válido todos los días.')).toEqual({ days: 'all', daysText: 'Válido todos los días.' })
  })

  it('lee rangos, listas y fines de semana', () => {
    expect(parseDays('Válido de lunes a jueves.').days).toEqual(['mon', 'tue', 'wed', 'thu'])
    expect(parseDays('Martes y miércoles.').days).toEqual(['tue', 'wed'])
    expect(parseDays('Sólo fines de semana.').days).toEqual(['sat', 'sun'])
    expect(parseDays('De viernes a domingo.').days).toEqual(['fri', 'sat', 'sun'])
  })

  it('una mención que no se puede leer con confianza es null, con el texto', () => {
    expect(parseDays('Válido de lunes a viernes excepto feriados.')).toEqual({ days: null, daysText: 'Válido de lunes a viernes excepto feriados.' })
    expect(parseDays('Lunes 2x1. Jueves 20%.').days).toBeNull()
  })
})

describe('parseCap', () => {
  it('monto, moneda y período', () => {
    expect(parseCap('4000 pesos uruguayos por cierre de estado de cuenta')).toEqual({ text: '4000 pesos uruguayos por cierre de estado de cuenta', amount: 4000, currency: 'UYU', period: 'statement' })
    expect(parseCap('$U 1.500 por mes')).toMatchObject({ amount: 1500, currency: 'UYU', period: 'month' })
    expect(parseCap('U$S 50 por compra')).toMatchObject({ amount: 50, currency: 'USD', period: 'purchase' })
  })

  it('lo que no se lee queda en null, con el texto', () => {
    expect(parseCap('4000 pesos uruguayos')).toEqual({ text: '4000 pesos uruguayos', amount: 4000, currency: 'UYU', period: null })
    expect(parseCap('el que indique el comercio')).toEqual({ text: 'el que indique el comercio', amount: null, currency: null, period: null })
    expect(parseCap('Sin tope')).toEqual({ text: 'Sin tope', amount: null, currency: null, period: null })
    expect(parseCap(null)).toBeNull()
  })
})
