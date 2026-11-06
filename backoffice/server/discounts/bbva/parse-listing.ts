import { load } from 'cheerio'
import { DiscountSourceError } from '../errors.ts'

export type BbvaListingCard = {
  name: string
  /** "Cafetería en Canelones", "Carnicería en Pocitos, Montevideo". */
  preheadline: string | null
  detailUrl: string
  logoUrl: string | null
  /** Etiquetas de filtro, sin la coma final: tarjetas (también co-branded) y departamento. */
  tags: string[]
}

export type BbvaListingPage = {
  cards: BbvaListingCard[]
  /** Todas las páginas del listado que enlaza esta (absolutas), incluida la primera. */
  pageUrls: string[]
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()

const PAGE_PATH = /\/gastronomia(?:\.pag-\d+)?\.html$/

/** Una página del listado de gastronomía. Falla si no tiene cards o si una card no tiene nombre o link. */
export function parseBbvaListing(html: string, pageUrl: string): BbvaListingPage {
  const $ = load(html)
  const articles = $('article.promocard__base')
  if (articles.length === 0) {
    throw new DiscountSourceError('bbva', `El listado no tiene cards de descuentos (article.promocard__base): cambió la estructura de la página.`, pageUrl)
  }
  const cards: BbvaListingCard[] = []
  articles.each((index, element) => {
    const card = $(element)
    const name = clean(card.find('h3.card__title').first().text())
    const href = card.find('.card__content a[href]').first().attr('href') ?? card.find('a[href]').first().attr('href')
    if (!name || !href) {
      throw new DiscountSourceError('bbva', `La card ${index + 1} del listado no tiene nombre o link al detalle: cambió la estructura.`, pageUrl)
    }
    const src = card.find('img').first().attr('src')
    cards.push({
      name,
      preheadline: clean(card.find('.card__preheadline').first().text()) || null,
      detailUrl: new URL(href, pageUrl).toString(),
      logoUrl: src ? new URL(src, pageUrl).toString() : null,
      tags: card.find('.filter__tag').toArray().map((tag) => clean($(tag).text()).replace(/\s*,$/, '')).filter(Boolean),
    })
  })
  const pageUrls = new Set<string>([new URL(pageUrl).toString()])
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href')!
    const url = new URL(href, pageUrl)
    url.hash = ''
    // pag-1 es la misma primera página.
    url.pathname = url.pathname.replace(/\.pag-1\.html$/, '.html')
    if (url.host === new URL(pageUrl).host && PAGE_PATH.test(url.pathname)) pageUrls.add(url.toString())
  })
  return { cards, pageUrls: [...pageUrls].sort(pageOrder) }
}

const pageNumber = (url: string) => Number(/\.pag-(\d+)\.html$/.exec(url)?.[1] ?? 1)
const pageOrder = (a: string, b: string) => pageNumber(a) - pageNumber(b)
