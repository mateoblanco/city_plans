import { describe, expect, it, vi } from 'vitest'
import type { PageFetcher } from '../polite-fetch.ts'
import { DISCOUNT_PROVIDERS } from '../providers.ts'
import type { BenefitStructurer } from '../structure-benefits.ts'
import { BASE, fixture, LISTING_URL } from './fixtures.ts'
import { readBbva, splitSubtitle } from './reader.ts'

const provider = DISCOUNT_PROVIDERS[0]

/** Un listado de una página con las cards que se pidan, armado desde las cards reales. */
function listing(slugs: string[]) {
  const cards = slugs.map((slug) => `<article class="card__base promocard__base"><img src="/logo-${slug}.jpg"><div class="card__content"><p class="card__preheadline">Restaurante en Pocitos, Montevideo</p><a href="/personas/productos/tarjetas/descuentos/gastronomia/${slug}.html"><h3 class="card__title">${slug}</h3></a><div class="promocard__tag"><span class="filter__tag">Montevideo, </span></div></div></article>`)
  return `<html><body>${cards.join('')}</body></html>`
}

function fetcherOf(pages: Record<string, string>): PageFetcher & { urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    requests: 0,
    async get(url) {
      urls.push(url)
      if (!(url in pages)) throw new Error(`${url} respondió 404.`)
      return pages[url]
    },
  }
}

describe('readBbva', () => {
  it('recorre todas las páginas y cada detalle una vez, y arma los beneficios en el formato común', async () => {
    // Página 1 real (15 cards, que enlaza las páginas 2 a 6); el resto, una card cada una.
    const pages: Record<string, string> = { [LISTING_URL]: fixture('listing-1.html') }
    for (const match of fixture('listing-1.html').matchAll(/href="(\/personas\/productos\/tarjetas\/descuentos\/gastronomia\/[^"]+\.html)"/g)) pages[`https://www.bbva.com.uy${match[1]}`] = fixture('nagasaki.html')
    for (const n of [2, 3, 4, 5]) {
      pages[`${BASE}gastronomia.pag-${n}.html`] = listing([`p${n}`])
      pages[`${BASE}gastronomia/p${n}.html`] = fixture('up-lavista.html')
    }
    // Porterhouse ya está en la página 1: aparece otra vez en la 6 y no se repite.
    pages[`${BASE}gastronomia.pag-6.html`] = listing(['porterhouse'])
    pages[`${BASE}gastronomia/porterhouse.html`] = fixture('porterhouse.html')
    const fetcher = fetcherOf(pages)
    const progress = vi.fn()
    const result = await readBbva({ provider, fetcher, onProgress: progress })

    expect(result.places).toHaveLength(15 + 4)
    expect(new Set(fetcher.urls).size).toBe(fetcher.urls.length)
    expect(result.errors).toEqual([])
    const porterhouse = result.places.find((place) => place.id === 'bbva:porterhouse')!
    expect(porterhouse).toMatchObject({ sourceName: 'Porterhouse', category: 'Carnicería', city: 'Pocitos, Montevideo', departments: ['Montevideo'], montevideo: true })
    expect(porterhouse.benefits).toHaveLength(3)
    expect(porterhouse.benefits[2]).toMatchObject({
      percent: 30, cardType: 'credit', cardTiers: ['Platinum', 'Black', 'Infinite'], cardProgram: null,
      days: 'all', daysText: null, mode: 'mixed', instantPercent: 10, refundPercent: 20,
      cap: { text: '6000 pesos uruguayos por cierre de estado de cuenta', amount: 6000, currency: 'UYU', period: 'statement' },
      validFrom: '2026-11-01', validTo: '2027-10-31', parsedBy: 'html',
    })
    expect(porterhouse.benefits[2].conditions).toContain('no acumulable')
    expect(porterhouse.benefits[2].sourceText).toContain('El descuento será de un 30%')
    expect(progress).toHaveBeenLastCalledWith({ phase: 'details', done: 19, total: 19 })
    // Ids estables y únicos por lugar.
    expect(new Set(porterhouse.benefits.map((benefit) => benefit.id)).size).toBe(3)
  })

  it('un detalle que no carga es un error parcial; el lugar queda con lo del listado', async () => {
    const fetcher = fetcherOf({ [LISTING_URL]: listing(['porterhouse', 'roto']), [`${BASE}gastronomia/porterhouse.html`]: fixture('porterhouse.html') })
    const result = await readBbva({ provider, fetcher })
    expect(result.unread).toEqual(['bbva:roto'])
    expect(result.places.map((place) => place.sourceName)).toEqual(['Porterhouse', 'roto'])
    expect(result.places[1].benefits).toEqual([])
    expect(result.errors).toEqual([expect.objectContaining({ url: `${BASE}gastronomia/roto.html`, message: expect.stringContaining('404') })])
  })

  it('0 lugares o ningún detalle legible es un error, no una lista vacía', async () => {
    await expect(readBbva({ provider, fetcher: fetcherOf({ [LISTING_URL]: '<html></html>' }) })).rejects.toThrow('cambió la estructura')
    const broken = fetcherOf({ [LISTING_URL]: listing(['a']), [`${BASE}gastronomia/a.html`]: '<h1 class="h1title__title">A</h1>' })
    await expect(readBbva({ provider, fetcher: broken })).rejects.toThrow('Ninguno de los 1 detalles')
  })

  it('el texto que las reglas no leen va al modelo, y su costo se suma', async () => {
    const odd = fixture('porterhouse.html').replace('<li><b>20% Off con Tarjetas de Débito</b></li>', '<li><b>Débito: 20% de reintegro los martes</b></li>')
    const structure: BenefitStructurer = vi.fn(async () => ({
      benefits: [{ percent: 20, cardType: 'debit' as const, cardTiers: [], instantPercent: null, refundPercent: 20, cap: null, daysText: 'los martes' }],
      costUsd: 0.0003,
      cached: false,
    }))
    const result = await readBbva({ provider, fetcher: fetcherOf({ [LISTING_URL]: listing(['porterhouse']), [`${BASE}gastronomia/porterhouse.html`]: odd }), structure })
    expect(structure).toHaveBeenCalledWith(expect.stringContaining('Débito: 20% de reintegro los martes'))
    const debit = result.places[0].benefits.find((benefit) => benefit.cardType === 'debit')!
    expect(debit).toMatchObject({ parsedBy: 'llm', mode: 'refund', days: ['tue'], daysText: 'los martes' })
    expect(result.llm).toEqual({ calls: 1, costUsd: 0.0003 })
  })

  it('lo del modelo completa el beneficio de las reglas aunque escriba los niveles distinto', async () => {
    // El párrafo legal del 30% sin modalidad que las reglas puedan leer.
    const odd = fixture('porterhouse.html').replace(/El descuento será de un 30%[^<]*/, 'El descuento será de un 30%, según la modalidad que informe el comercio.')
    const structure: BenefitStructurer = vi.fn(async () => ({
      benefits: [{ percent: 30, cardType: 'credit' as const, cardTiers: ['Platinum', 'Black', 'Infinite'], instantPercent: null, refundPercent: 30, cap: '6000 pesos uruguayos', daysText: null }],
      costUsd: 0.001,
      cached: false,
    }))
    const result = await readBbva({ provider, fetcher: fetcherOf({ [LISTING_URL]: listing(['porterhouse']), [`${BASE}gastronomia/porterhouse.html`]: odd }), structure })
    expect(result.places[0].benefits).toHaveLength(3)
    expect(result.places[0].benefits[2]).toMatchObject({ parsedBy: 'llm', mode: 'refund', refundPercent: 30, cardTiers: ['Platinum', 'Black', 'Infinite'] })
  })

  it('sin modelo, ese texto queda como aviso', async () => {
    const odd = fixture('porterhouse.html').replace('<li><b>20% Off con Tarjetas de Débito</b></li>', '<li><b>Débito: 2x1</b></li>')
    const result = await readBbva({ provider, fetcher: fetcherOf({ [LISTING_URL]: listing(['porterhouse']), [`${BASE}gastronomia/porterhouse.html`]: odd }) })
    expect(result.places[0].benefits).toHaveLength(2)
    expect(result.warnings).toEqual([expect.stringContaining('Sin modelo configurado')])
  })

  it('Marmatu: una línea de crédito para todos los niveles con párrafos iguales', async () => {
    const result = await readBbva({ provider, fetcher: fetcherOf({ [LISTING_URL]: listing(['marmatu']), [`${BASE}gastronomia/marmatu.html`]: fixture('marmatu.html') }) })
    expect(result.places[0].benefits.map((benefit) => benefit.mode)).toEqual(['mixed', 'mixed'])
    expect(result.warnings).toEqual([])
  })
})

describe('splitSubtitle', () => {
  it('separa rubro y lugar; un lema no es un lugar', () => {
    expect(splitSubtitle('Carnicería en Pocitos, Montevideo')).toEqual({ category: 'Carnicería', city: 'Pocitos, Montevideo' })
    expect(splitSubtitle('Cocina de Fuegos | Buena Coctelería | Música en Vivo')).toEqual({ category: null, city: null })
    expect(splitSubtitle('Empanadas Premium')).toEqual({ category: 'Empanadas Premium', city: null })
  })
})
