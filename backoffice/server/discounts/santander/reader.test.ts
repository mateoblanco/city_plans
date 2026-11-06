import { describe, expect, it, vi } from 'vitest'
import type { PageFetcher } from '../polite-fetch.ts'
import type { BenefitStructurer } from '../structure-benefits.ts'
import { DETAIL, fixture, pageUrl, SANTANDER } from './fixtures.ts'
import { isErrorPage, readSantander, santanderPageUrl } from './reader.ts'

/** Una página del listado (estructura real) con estas cards, más la lista del mapa con `mapList`. */
function listing(cards: { slug: string; name: string; text: string; tags?: string[] }[], options: { next?: number; mapList?: string[] } = {}) {
  const card = ({ slug, name, text, tags = [] }: { slug: string; name: string; text: string; tags?: string[] }) =>
    `<article class="node--type-beneficios"><h3>${name}</h3>${tags.map((tag) => `<div class="tag">${tag}</div>`).join('')}<div class="field--name-body"><p>${text.replace(/\n/g, '<br />')}</p></div><a href="/beneficios/${slug}">Ver más detalles</a></article>`
  const mapList = (options.mapList ?? []).map((slug) => `<article class="node--type-beneficios"><h3>${slug}</h3><a href="/beneficios/${slug}">x</a></article>`).join('')
  const pager = options.next === undefined ? '' : `<ul class="pager"><li class="pager__item"><a href="?page=${options.next}">Ver más</a></li></ul>`
  return `<div class="view-display-id-benefits_card_map">${cards.map(card).join('')}<div class="view-display-id-list_map">${mapList}</div>${pager}</div>`
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

const STANDARD = '25% con Platinum, Select y Private Banking.\n15% con crédito y débito.\nA los descuentos se suma la devolución de puntos de IVA.'

describe('readSantander', () => {
  it('la URL de cada página lleva los filtros del config', () => {
    expect(santanderPageUrl(SANTANDER, 2)).toBe('https://www.santander.com.uy/beneficios?departamento%5B0%5D=49&categoria=22&page=2')
  })

  it('las páginas reales: 7 páginas, 50 lugares sin repetir, coinciden con la lista del mapa', async () => {
    const zero = fixture('listing-0.html')
    const pages: Record<string, string> = { [pageUrl(0)]: zero, [pageUrl(6)]: fixture('listing-6.html') }
    // Las páginas 1 a 5 no están en los fixtures: las armo con las cards de la lista del mapa, de a 8.
    const { parseSantanderListing } = await import('./parse-listing.ts')
    const all = parseSantanderListing(zero, pageUrl(0)).mapListUrls.map((url) => url.replace(DETAIL, ''))
    const firstAndLast = new Set([...parseSantanderListing(zero, pageUrl(0)).cards, ...parseSantanderListing(fixture('listing-6.html'), pageUrl(6)).cards].map((card) => card.detailUrl.replace(DETAIL, '')))
    const middle = all.filter((slug) => !firstAndLast.has(slug))
    for (let page = 1; page <= 5; page += 1) {
      // Bequelo y Donut City, con su texto real: sólo canje de puntos.
      const textOf = (slug: string) => (/^(bequelo|donut-city)/.test(slug) ? 'El comercio acepta canje de puntos Soy Santander.' : STANDARD)
      const nameOf = (slug: string) => ({ bequelo: 'Bequelo', 'donut-city-0': 'Donut City' } as Record<string, string>)[slug] ?? slug
      pages[pageUrl(page)] = listing(middle.slice((page - 1) * 8, page * 8).map((slug) => ({ slug, name: nameOf(slug), text: textOf(slug) })), { next: page + 1 })
    }
    for (const slug of all) pages[`${DETAIL}${slug}`] = fixture('almar.html')
    const fetcher = fetcherOf(pages)
    const result = await readSantander({ provider: SANTANDER, fetcher })
    // Bequelo y Donut City son sólo canje de puntos: no se guardan.
    expect(result.places).toHaveLength(48)
    expect(new Set(fetcher.urls).size).toBe(fetcher.urls.length)
    expect(fetcher.urls.filter((url) => url.includes('page='))).toHaveLength(7)
    expect(result.warnings).toEqual([])
    expect(result.notes).toEqual(expect.arrayContaining([
      expect.stringMatching(/^Beneficios: \d+ por reglas, 0 por el modelo\.$/),
      'Sólo canje de puntos, sin porcentaje (no se guardan): 2 — Bequelo, Donut City.',
      expect.stringContaining('«A los descuentos se suma la devolución de puntos de IVA.»'),
    ]))
  })

  it('arma los beneficios en el formato común, con la modalidad y el tope del detalle', async () => {
    const fetcher = fetcherOf({ [pageUrl(0)]: listing([{ slug: 'almar', name: 'Almar', text: STANDARD, tags: ['Puntos'] }]), [`${DETAIL}almar`]: fixture('almar.html') })
    const { places, unread } = await readSantander({ provider: SANTANDER, fetcher })
    expect(unread).toEqual([])
    expect(places[0]).toMatchObject({ id: 'santander:almar', sourceName: 'Almar', montevideo: true, departments: ['Montevideo'], sourceTags: ['Puntos'], campaign: { validFrom: null, validTo: null, text: null } })
    expect(places[0].benefits.map((benefit) => [benefit.percent, benefit.cardType, benefit.cardTiers, benefit.mode, benefit.refundPercent])).toEqual([
      [25, 'credit', ['Platinum', 'Select', 'Private Banking'], 'refund', 25],
      [15, 'credit', [], 'refund', 15],
      [15, 'debit', [], 'refund', 15],
    ])
    expect(places[0].benefits[0].cap).toMatchObject({ amount: null, text: expect.stringContaining('Private Banking hasta UYU 6.000') })
    expect(new Set(places[0].benefits.map((benefit) => benefit.id)).size).toBe(3)
  })

  it('"15% todos los días": en el momento, sin tipo de tarjeta, y el local de La Barra queda con coordenadas', async () => {
    const fetcher = fetcherOf({ [pageUrl(0)]: listing([{ slug: 'cali-cafe', name: 'Cali Cafe', text: '15% de descuento todos los días.' }]), [`${DETAIL}cali-cafe`]: fixture('cali-cafe.html') })
    const { places } = await readSantander({ provider: SANTANDER, fetcher })
    expect(places[0].benefits).toEqual([expect.objectContaining({ percent: 15, cardType: 'other', mode: 'instant', instantPercent: 15, days: 'all' })])
    expect(places[0].locations).toHaveLength(2)
  })

  it('la página de error con status 200: un reintento; si sigue, error parcial y el lugar queda sin leer', async () => {
    expect(isErrorPage(fixture('error-503.html'))).toBe(true)
    let calls = 0
    const pages = { [pageUrl(0)]: listing([{ slug: 'nora-rey', name: 'Nora Rey', text: STANDARD }, { slug: 'almar', name: 'Almar', text: STANDARD }]), [`${DETAIL}almar`]: fixture('almar.html') }
    const fetcher: PageFetcher = {
      requests: 0,
      async get(url) {
        if (url.endsWith('nora-rey')) {
          calls += 1
          return fixture('error-503.html')
        }
        return pages[url]
      },
    }
    const result = await readSantander({ provider: SANTANDER, fetcher })
    expect(calls).toBe(2)
    expect(result.unread).toEqual(['santander:nora-rey'])
    expect(result.errors).toEqual([expect.objectContaining({ url: `${DETAIL}nora-rey`, message: expect.stringContaining('Error 503') })])
  })

  it('si la paginación no termina, corta con un error claro', async () => {
    const provider = { ...SANTANDER, listing: { ...SANTANDER.listing!, maxPages: 2 } }
    const pages = { [santanderPageUrl(provider, 0)]: listing([{ slug: 'a', name: 'A', text: STANDARD }], { next: 1 }), [santanderPageUrl(provider, 1)]: listing([{ slug: 'b', name: 'B', text: STANDARD }], { next: 2 }) }
    await expect(readSantander({ provider, fetcher: fetcherOf(pages) })).rejects.toThrow('después de 2 páginas')
  })

  it('avisa si el paginado no coincide con la lista del mapa', async () => {
    const fetcher = fetcherOf({ [pageUrl(0)]: listing([{ slug: 'almar', name: 'Almar', text: STANDARD }], { mapList: ['almar', 'otro'] }), [`${DETAIL}almar`]: fixture('almar.html') })
    expect((await readSantander({ provider: SANTANDER, fetcher })).warnings).toEqual([expect.stringContaining('faltan en el paginado otro')])
  })

  it('el modelo lee lo que las reglas no, con su costo; nunca un débito que la fuente no dice', async () => {
    const structure: BenefitStructurer = vi.fn(async () => ({
      benefits: [
        { percent: 20, cardType: 'credit' as const, cardTiers: ['Visa'], instantPercent: null, refundPercent: null, cap: null, daysText: 'los martes' },
        { percent: 20, cardType: 'debit' as const, cardTiers: [], instantPercent: null, refundPercent: null, cap: null, daysText: 'los martes' },
      ],
      costUsd: 0.0004,
      cached: false,
    }))
    const fetcher = fetcherOf({ [pageUrl(0)]: listing([{ slug: 'almar', name: 'Almar', text: '20% los martes con Visa Santander.' }]), [`${DETAIL}almar`]: fixture('almar.html') })
    const result = await readSantander({ provider: SANTANDER, fetcher, structure })
    expect(structure).toHaveBeenCalledWith('20% los martes con Visa Santander.')
    expect(result.places[0].benefits).toEqual([expect.objectContaining({ percent: 20, cardType: 'credit', cardTiers: ['Visa'], days: ['tue'], parsedBy: 'llm', mode: 'refund' })])
    expect(result.warnings).toEqual([expect.stringContaining('El modelo propuso un débito')])
    expect(result.llm).toEqual({ calls: 1, costUsd: 0.0004 })
    expect(result.notes?.[0]).toBe('Beneficios: 0 por reglas, 1 por el modelo.')
  })

  it('0 lugares es un error, no una lista vacía', async () => {
    await expect(readSantander({ provider: SANTANDER, fetcher: fetcherOf({ [pageUrl(0)]: listing([]) }) })).rejects.toThrow('no trajo ningún lugar')
  })
})
