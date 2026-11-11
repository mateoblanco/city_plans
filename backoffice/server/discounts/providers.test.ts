import { describe, expect, it } from 'vitest'
import { DISCOUNT_PROVIDERS } from '../../src/types/discounts.ts'
import { discountProviders, parseDiscountSources } from './providers.ts'

describe('config de fuentes (config/discount-sources.json)', () => {
  it('el archivo real: cada proveedor del catálogo con sus fuentes, en el orden del catálogo', () => {
    const providers = discountProviders()
    expect(providers.map((provider) => provider.id)).toEqual(DISCOUNT_PROVIDERS.map((provider) => provider.id))
    expect(providers.find((provider) => provider.id === 'santander')).toMatchObject({ sourceUrl: 'https://www.santander.com.uy/beneficios', listing: { params: { 'departamento[0]': '49', categoria: '22' }, maxPages: 30 } })
    expect(providers.find((provider) => provider.id === 'itau')?.pages?.map((page) => page.label)).toEqual(['Restaurantes', 'Platinum', 'Personal Bank'])
    expect(providers.find((provider) => provider.id === 'scotiabank')).toMatchObject({ name: 'Scotiabank', kind: 'bank', sourceUrl: 'https://www.scotiabank.com.uy/Personas/Tarjetas/Beneficios/default' })
    expect(providers.find((provider) => provider.id === 'brou')).toMatchObject({ name: 'BROU', kind: 'bank', pages: [{ url: 'https://beneficios.brou.com.uy/gastronomia/gastronomia-verano-2026-2027', label: 'Gastronomía Verano 2026-2027' }] })
  })

  const valid = () => Object.fromEntries(DISCOUNT_PROVIDERS.map((provider) => [provider.id, { sourceUrl: `https://${provider.id}.test/` }]))

  it('valida contra el catálogo y los valores permitidos', () => {
    expect(parseDiscountSources({ providers: valid() })).toHaveLength(DISCOUNT_PROVIDERS.length)
    expect(() => parseDiscountSources({ providers: { ...valid(), otro: { sourceUrl: 'https://otro.test/' } } })).toThrow(/no están en el catálogo: otro/)
    const { brou: _brou, ...withoutBrou } = valid()
    expect(() => parseDiscountSources({ providers: withoutBrou })).toThrow(/no tiene fuente para: brou/)
    expect(() => parseDiscountSources({ providers: { ...valid(), brou: { sourceUrl: 'http://beneficios.brou.com.uy/' } } })).toThrow(/https/)
    expect(() => parseDiscountSources({ providers: { ...valid(), itau: { sourceUrl: 'https://itau.test/', pages: [{ url: 'https://itau.test/a', label: 'A', cards: [{ cardType: 'gold', cardTiers: [] }] }] } } })).toThrow(/cardType/)
    expect(() => parseDiscountSources({ providers: { ...valid(), itau: { sourceUrl: 'https://itau.test/', pages: [{ url: 'https://itau.test/a', label: 'A', manualMatchFrom: 'nadie' }] } } })).toThrow(/manualMatchFrom/)
    expect(() => parseDiscountSources({ providers: { ...valid(), bbva: { sourceUrl: 'https://bbva.test/', extra: 1 } } })).toThrow(/no es válido/)
  })
})
