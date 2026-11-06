import { load, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import { DiscountSourceError } from '../errors.ts'
import { cleanText } from '../text.ts'

export type SantanderCard = {
  name: string
  /** Texto del beneficio, con un renglón por <br>/<p>. */
  benefitText: string
  detailUrl: string
  logoUrl: string | null
  /** Etiquetas de la card ("Puntos": además acepta canje de puntos). */
  tags: string[]
}

export type SantanderListingPage = {
  cards: SantanderCard[]
  /** El "Ver más" (página siguiente), absoluto; null en la última. */
  nextUrl: string | null
  /** Los links de la lista del mapa (list_map: todos los del filtro, sin paginar), para el control cruzado. */
  mapListUrls: string[]
}

// La página tiene varias vistas de Drupal: el listado paginado (benefits_card_map, 8 por página) contiene la lista del
// mapa (list_map, todos de una vez, ignora `page`). Las cards son las del listado que no están en la del mapa.
const LISTING = '.view-display-id-benefits_card_map'
const MAP_LIST = '.view-display-id-list_map'
const CARD = 'article.node--type-beneficios'

/** El texto de un bloque con un renglón por <br> o <p>. */
export function textWithBreaks($: CheerioAPI, element: AnyNode | ReturnType<CheerioAPI>): string {
  const clone = $(element as AnyNode).clone()
  clone.find('br').replaceWith('\n')
  clone.find('p, li').each((_, item) => {
    $(item).append('\n')
  })
  return clone.text().split('\n').map(cleanText).filter(Boolean).join('\n')
}

function cardOf($: CheerioAPI, element: AnyNode, pageUrl: string, index: number): SantanderCard {
  const card = $(element)
  const name = cleanText(card.find('h3').first().text())
  const href = card.find('a[href^="/beneficios/"], a[href*="santander.com.uy/beneficios/"]').first().attr('href')
  if (!name || !href) throw new DiscountSourceError('santander', `La card ${index + 1} del listado no tiene nombre o link al detalle: cambió la estructura.`, pageUrl)
  const body = card.find('.field--name-body').first()
  const logo = card.find('.field--name-field-company-logo img, img').first().attr('src')
  return {
    name,
    benefitText: body.length ? textWithBreaks($, body) : '',
    detailUrl: new URL(href, pageUrl).toString(),
    logoUrl: logo ? new URL(logo, pageUrl).toString() : null,
    tags: card.find('.tag').toArray().map((tag) => cleanText($(tag).text())).filter(Boolean),
  }
}

/** Una página del listado filtrado. Falla si no está el listado (cambió la estructura). */
export function parseSantanderListing(html: string, pageUrl: string): SantanderListingPage {
  const $ = load(html)
  const listing = $(LISTING).first()
  if (listing.length === 0) {
    throw new DiscountSourceError('santander', `La página no tiene el listado de beneficios (${LISTING}): cambió la estructura.`, pageUrl)
  }
  const cards = listing.find(CARD).filter((_, element) => $(element).closest(MAP_LIST).length === 0).toArray()
    .map((element, index) => cardOf($, element, pageUrl, index))
  const next = listing.find('.pager__item a[href]').first().attr('href')
  const mapListUrls = [...new Set($(`${MAP_LIST} ${CARD}`).toArray().flatMap((element) => {
    const href = $(element).find('a[href^="/beneficios/"]').first().attr('href')
    return href ? [new URL(href, pageUrl).toString()] : []
  }))]
  return { cards, nextUrl: next ? new URL(next, pageUrl).toString() : null, mapListUrls }
}
