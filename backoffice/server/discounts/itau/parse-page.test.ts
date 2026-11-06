import { describe, expect, it } from 'vitest'
import { DiscountSourceError } from '../errors.ts'
import { fixture, PAGE } from './fixtures.ts'
import { parseItauPage } from './parse-page.ts'

describe('parseItauPage', () => {
  it('Restaurantes: secciones por ciudad, con su porcentaje y texto', () => {
    const page = parseItauPage(fixture('restaurantes'), PAGE('restaurantes'))
    const restaurants = page.sections.filter((section) => section.kind === 'restaurants')
    expect(restaurants.map((section) => [section.city, section.percent, section.logos.length])).toEqual([
      ['Montevideo', 15, 77], ['Punta del Este', 15, expect.any(Number)],
      ['Colonia', 15, 6], ['Mercedes', 15, 1], ['Paysandú', 15, 3], ['Rocha', 15, 3], ['Salto', 15, 3],
    ])
    expect(restaurants[0].text).toBe('15% menos Todos los días, con tarjetas de crédito Itaú de Uruguay.')
  })

  it('el nombre sale del alt; el link a Instagram o a otra web', () => {
    const logos = parseItauPage(fixture('restaurantes'), PAGE('restaurantes')).sections[0].logos
    expect(logos.find((logo) => logo.name === 'Basílico')).toMatchObject({ instagram: 'basilicouy', website: null })
    expect(logos.find((logo) => logo.name === 'Escaramuza')).toMatchObject({ instagram: null, website: 'https://escaramuza.com.uy/libros-destacados' })
    expect(logos.find((logo) => logo.name === '1921')).toMatchObject({ instagram: null, website: null, logoUrl: expect.stringMatching(/^https:\/\/comunicaciones\.itau\.com\.uy\//) })
  })

  it('las tiendas gourmet quedan aparte', () => {
    const gourmet = parseItauPage(fixture('restaurantes'), PAGE('restaurantes')).sections.filter((section) => section.kind === 'gourmet')
    expect(gourmet.map((section) => [section.city, section.logos.length])).toEqual([['Montevideo', 11], ['Punta del Este', expect.any(Number)], ['Colonia', 2]])
  })

  it('Platinum: dos secciones de restaurantes en Montevideo (20% y 15%) y las bases por región', () => {
    const page = parseItauPage(fixture('restaurantesplatinum'), PAGE('restaurantesplatinum'))
    const montevideo = page.sections.filter((section) => section.city === 'Montevideo' && section.kind === 'restaurants')
    expect(montevideo.map((section) => [section.percent, section.logos.length])).toEqual([[20, 69], [15, 9]])
    expect(page.terms).toMatch(/^Punta del este - Vigencia de la campaña/)
    expect(page.terms).toContain('\nMontevideo e interior - Vigencia de la campaña')
  })

  it('falla con un error claro si cambió la estructura', () => {
    expect(() => parseItauPage('<html><body><h1>Restaurantes</h1></body></html>', PAGE('restaurantes'))).toThrow(DiscountSourceError)
    expect(() => parseItauPage('<section id="tab-mvd"><h2>Restaurantes</h2><div id="restaurant-x"><img alt="X"></div></section>', PAGE('restaurantes'))).toThrow('no dice el porcentaje')
  })
})
