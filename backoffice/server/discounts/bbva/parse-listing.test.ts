import { describe, expect, it } from 'vitest'
import { DiscountSourceError } from '../errors.ts'
import { BASE, fixture, LISTING_URL } from './fixtures.ts'
import { parseBbvaListing } from './parse-listing.ts'

describe('parseBbvaListing', () => {
  it('lee las cards de la primera página y todas las páginas del listado', () => {
    const page = parseBbvaListing(fixture('listing-1.html'), LISTING_URL)
    expect(page.cards).toHaveLength(15)
    expect(page.pageUrls).toEqual([LISTING_URL, ...[2, 3, 4, 5, 6].map((n) => `${BASE}gastronomia.pag-${n}.html`)])
    const amado = page.cards.find((card) => card.name === 'Amado')!
    expect(amado).toMatchObject({
      preheadline: 'Cafetería en Canelones',
      detailUrl: `${BASE}gastronomia/amado.html`,
    })
    expect(amado.logoUrl).toMatch(/^https:\/\/www\.bbva\.com\.uy\/content\/dam\/.+Amado/)
    expect(amado.tags).toContain('Canelones')
    expect(amado.tags).toContain('Tarjeta de Crédito Peñarol')
  })

  it('en la última página, pag-1 es la primera (no se baja dos veces)', () => {
    const page = parseBbvaListing(fixture('listing-6.html'), `${BASE}gastronomia.pag-6.html`)
    expect(page.cards).toHaveLength(8)
    expect(page.pageUrls).toHaveLength(6)
    expect(page.pageUrls[0]).toBe(LISTING_URL)
  })

  it('falla con un error claro si cambió la estructura', () => {
    expect(() => parseBbvaListing('<html><body><h1>Gastronomía</h1></body></html>', LISTING_URL)).toThrow(DiscountSourceError)
    expect(() => parseBbvaListing('<html><body></body></html>', LISTING_URL)).toThrow('cambió la estructura')
    expect(() => parseBbvaListing('<article class="promocard__base"><p>sin título</p></article>', LISTING_URL)).toThrow('no tiene nombre o link')
  })
})
