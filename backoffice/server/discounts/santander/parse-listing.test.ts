import { describe, expect, it } from 'vitest'
import { DiscountSourceError } from '../errors.ts'
import { DETAIL, fixture, pageUrl } from './fixtures.ts'
import { parseSantanderListing } from './parse-listing.ts'

describe('parseSantanderListing', () => {
  it('las 8 cards del listado paginado, sin la lista del mapa, y el "Ver más"', () => {
    const page = parseSantanderListing(fixture('listing-0.html'), pageUrl(0))
    expect(page.cards).toHaveLength(8)
    expect(page.cards[0]).toMatchObject({ name: 'Bruta', detailUrl: `${DETAIL}bruta` })
    expect(page.cards[0].benefitText).toBe('25% con Platinum, Select y Private Banking.\n15% con crédito y débito.\nA los descuentos se suma la devolución de puntos de IVA.')
    expect(page.cards[0].logoUrl).toMatch(/^https:\/\/www\.santander\.com\.uy\/sites\/default\/files\//)
    expect(page.nextUrl).toContain('page=1')
    // La lista del mapa trae los 50 de una vez.
    expect(page.mapListUrls).toHaveLength(50)
  })

  it('la última página: 2 cards y sin "Ver más"', () => {
    const page = parseSantanderListing(fixture('listing-6.html'), pageUrl(6))
    expect(page.cards.map((card) => card.name)).toEqual(['La Esquina Café', 'El Naranjo'])
    expect(page.nextUrl).toBeNull()
  })

  it('la etiqueta "Puntos"', () => {
    const cards = parseSantanderListing(fixture('listing-0.html'), pageUrl(0)).cards
    expect(cards.find((card) => card.name === 'La Pasiva Arocena')?.tags).toEqual(['Puntos'])
  })

  it('falla con un error claro si no está el listado', () => {
    expect(() => parseSantanderListing('<html><body><h1>Beneficios</h1></body></html>', pageUrl(0))).toThrow(DiscountSourceError)
    expect(() => parseSantanderListing(fixture('error-503.html'), pageUrl(0))).toThrow('cambió la estructura')
  })
})
