import { describe, expect, it } from 'vitest'
import type { PageFetcher } from '../polite-fetch.ts'
import { parseItauSectionText } from './benefit-text.ts'
import { fixture, ITAU, PAGE, PERSONAL_BANK } from './fixtures.ts'
import { readItau, termsFor } from './reader.ts'

const fetcherOf = (pages: Record<string, string>): PageFetcher => ({
  requests: 0,
  async get(url) {
    if (!(url in pages)) throw new Error(`${url} respondió 404.`)
    return pages[url]
  },
})
const ITAU_PAGES = {
  [PAGE('restaurantes')]: fixture('restaurantes'),
  [PAGE('restaurantesplatinum')]: fixture('restaurantesplatinum'),
  [PAGE('restaurantespersonalbank')]: fixture('restaurantespersonalbank'),
}

describe('texto de sección de Itaú', () => {
  it('crédito Itaú, Platinum y Personal Bank (con Infinite y Black)', () => {
    const shape = (text: string) => parseItauSectionText(text)?.map(({ cardType, cardTiers, days }) => ({ cardType, cardTiers, days }))
    expect(shape('15% menos Todos los días, con tarjetas de crédito Itaú de Uruguay.')).toEqual([{ cardType: 'credit', cardTiers: [], days: 'all' }])
    expect(shape('20% menos Todos los días, pagando con tus tarjetas de crédito Platinum.')).toEqual([{ cardType: 'credit', cardTiers: ['Platinum'], days: 'all' }])
    expect(shape('25% menos Todos los días, con tarjetas de débito y crédito Personal Bank. Incluye Infinite y Black. Los restaurantes destacados corresponden a beneficios exclusivos para clientes Personal Bank. Incluye Infinite y Black.')).toEqual([
      { cardType: 'debit', cardTiers: [], days: 'all' },
      { cardType: 'credit', cardTiers: [], days: 'all' },
      { cardType: 'credit', cardTiers: ['Infinite', 'Black'], days: 'all' },
    ])
    // Sin tipo de tarjeta: al modelo.
    expect(parseItauSectionText('15% menos Todos los días.')).toBeNull()
  })

  it('las bases por región y las vigencias ("setiembre del 2026", "hasta el 01/12/2026")', () => {
    const platinum = 'Punta del este - Vigencia de la campaña: Del 1 de setiembre 2026 al 30 de setiembre del 2026.\n20% … al momento de la compra.\nMontevideo e interior - Vigencia de la campaña: Del 2 de setiembre 2026 al 29 de setiembre del 2026.\n20% … al momento de la compra.'
    expect(termsFor(platinum, 'pde')).toMatchObject({ validFrom: '2026-09-01', validTo: '2026-09-30', mode: 'instant' })
    expect(termsFor(platinum, 'mvd')).toMatchObject({ validFrom: '2026-09-02', validTo: '2026-09-29', text: expect.stringMatching(/^Montevideo e interior/) })
    expect(termsFor(platinum, 'interior')?.validTo).toBe('2026-09-29')
    expect(termsFor('Campaña vigente hasta el 01/12/2026\n25% menos … al momento de la compra.', 'mvd')).toMatchObject({ validFrom: null, validTo: '2026-12-01', mode: 'instant' })
  })
})

describe('readItau', () => {
  it('Itaú: un lugar en varias páginas es uno solo, con el beneficio de cada página (Personal Bank: crédito Visa Infinite y Mastercard Black)', async () => {
    const result = await readItau({ provider: ITAU, fetcher: fetcherOf(ITAU_PAGES) })
    const perdiz = result.places.find((place) => place.id === 'itau:montevideo:la-perdiz')!
    expect(perdiz).toMatchObject({ sourceName: 'La Perdiz', city: 'Montevideo', departments: ['Montevideo'], montevideo: true, instagram: 'laperdizmvd', locations: [], sourceTags: ['Restaurantes', 'Platinum', 'Personal Bank'] })
    expect(perdiz.benefits.map((benefit) => [benefit.percent, benefit.cardType, benefit.cardTiers, benefit.mode, benefit.sourceUrl])).toEqual([
      [15, 'credit', [], 'instant', PAGE('restaurantes')],
      [20, 'credit', ['Platinum'], 'instant', PAGE('restaurantesplatinum')],
      [25, 'credit', ['Visa Infinite', 'Mastercard Black'], 'instant', PAGE('restaurantespersonalbank')],
    ])
    expect(perdiz.benefits[0]).toMatchObject({ validFrom: '2026-09-01', validTo: '2026-09-30', conditions: expect.stringContaining('no acumulable'), days: 'all', parsedBy: 'html' })
    // Las bases y la vigencia del de Personal Bank son las de su página.
    expect(perdiz.benefits[2]).toMatchObject({ validTo: '2026-12-01', days: 'all', parsedBy: 'html' })
    expect(new Set(perdiz.benefits.map((benefit) => benefit.id)).size).toBe(3)
  })

  it('Itaú: un logo que está sólo en Personal Bank igual es un lugar de Itaú, con sólo ese beneficio', async () => {
    const result = await readItau({ provider: ITAU, fetcher: fetcherOf(ITAU_PAGES) })
    const onlyPersonalBank = result.places.filter((place) => place.sourceTags.join() === 'Personal Bank')
    expect(onlyPersonalBank.length).toBeGreaterThan(0)
    for (const place of onlyPersonalBank) {
      expect(place.id).toMatch(/^itau:/)
      expect(place.sourceUrl).toBe(PAGE('restaurantespersonalbank'))
      // El porcentaje es el de su sección (la página tiene una de 25% y otra de 15%).
      expect(place.benefits.map((benefit) => [benefit.cardType, benefit.cardTiers, benefit.sourceUrl])).toEqual([['credit', ['Visa Infinite', 'Mastercard Black'], PAGE('restaurantespersonalbank')]])
      expect([15, 25]).toContain(place.benefits[0].percent)
    }
    expect(result.notes).toEqual(expect.arrayContaining([expect.stringMatching(/^Personal Bank: \d+ restaurantes\.$/)]))
  })

  it('Itaú: el mismo nombre en dos ciudades son dos lugares; Punta del Este es Maldonado y no se cruza', async () => {
    const { places } = await readItau({ provider: ITAU, fetcher: fetcherOf(ITAU_PAGES) })
    const hasami = places.filter((place) => place.sourceName === 'Hasami')
    expect(hasami.map((place) => [place.id, place.departments, place.montevideo])).toEqual([
      ['itau:montevideo:hasami', ['Montevideo'], true],
      ['itau:punta-del-este:hasami', ['Maldonado'], false],
    ])
  })

  it('Itaú: tiendas gourmet en las notas, no como lugares', async () => {
    const result = await readItau({ provider: ITAU, fetcher: fetcherOf(ITAU_PAGES) })
    expect(result.notes).toEqual(expect.arrayContaining([expect.stringMatching(/^Restaurantes: \d+ tiendas gourmet \(no se guardan\)\.$/), expect.stringMatching(/^Platinum: \d+ tiendas gourmet/)]))
    expect(result.places.some((place) => place.sourceName === 'Mercado Verde')).toBe(false)
  })

  it('Personal Bank: débito y crédito del paquete, sin niveles (Infinite y Black van a Itaú), hasta el 1/12/2026', async () => {
    const { places } = await readItau({ provider: PERSONAL_BANK, fetcher: fetcherOf({ [PAGE('restaurantespersonalbank')]: fixture('restaurantespersonalbank') }) })
    const montevideo = places.filter((place) => place.montevideo)
    expect(montevideo).toHaveLength(86)
    expect(montevideo[0].benefits.map((benefit) => [benefit.percent, benefit.cardType, benefit.cardTiers])).toEqual([[25, 'debit', []], [25, 'credit', []]])
    expect(montevideo[0].benefits[0]).toMatchObject({ mode: 'instant', instantPercent: 25, validFrom: null, validTo: '2026-12-01', sourceUrl: PAGE('restaurantespersonalbank') })
  })

  it('si una página no carga, el proveedor entero falla (no se marca nada inactivo)', async () => {
    await expect(readItau({ provider: ITAU, fetcher: fetcherOf({ [PAGE('restaurantes')]: fixture('restaurantes') }) })).rejects.toThrow('404')
  })
})
