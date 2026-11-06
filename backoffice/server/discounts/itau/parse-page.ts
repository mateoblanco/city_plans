import { load, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import { DiscountSourceError } from '../errors.ts'
import { instagramHandle } from '../bbva/parse-detail.ts'
import { cleanText, fold } from '../text.ts'
import { textWithBreaks } from '../santander/parse-listing.ts'

export type ItauLogo = {
  name: string
  logoUrl: string | null
  /** El link del logo: Instagram (handle) u otra web. */
  instagram: string | null
  website: string | null
}

export type ItauSection = {
  /** La pestaña del selector de ciudad: mvd, pde, interior. */
  region: string
  /** Montevideo, Punta del Este o la ciudad del Interior (el h2 antes de los logos). */
  city: string
  kind: 'restaurants' | 'gourmet'
  percent: number | null
  /** Los párrafos de la sección ("15% menos", "Todos los días, con tarjetas de crédito Itaú de Uruguay."). */
  text: string
  logos: ItauLogo[]
}

export type ItauPage = {
  sections: ItauSection[]
  /** El texto de "Bases y condiciones". */
  terms: string | null
}

// La pestaña dice la ciudad; en Interior la dice el h2 de ciudad.
const REGION_CITY: Record<string, string> = { mvd: 'Montevideo', pde: 'Punta del Este' }

const kindOf = (heading: string): ItauSection['kind'] | null => {
  const folded = fold(heading)
  if (folded.startsWith('restaurante')) return 'restaurants'
  if (folded.startsWith('tienda') || folded.includes('gourmet')) return 'gourmet'
  return null
}

function logoOf($: CheerioAPI, element: AnyNode, pageUrl: string): ItauLogo | null {
  const node = $(element)
  const image = node.find('img').first()
  const name = cleanText(image.attr('alt') || node.attr('title') || '')
  if (!name) return null
  const src = image.attr('src')
  const href = (node.is('a') ? node.attr('href') : null) ?? node.closest('a').attr('href') ?? node.find('a[href]').first().attr('href') ?? null
  const handle = href && /instagram\.com/i.test(href) ? instagramHandle(href) : null
  return {
    name,
    logoUrl: src ? new URL(src, pageUrl).toString() : null,
    instagram: handle,
    website: href && !handle && /^https?:\/\//.test(href) ? href : null,
  }
}

/** Una página de restaurantes de Itaú (las tres tienen el mismo armado). Falla si cambió la estructura. */
export function parseItauPage(html: string, pageUrl: string, providerId = 'itau'): ItauPage {
  const $ = load(html)
  const regions = $('section[id^="tab-"]')
  if (regions.length === 0) throw new DiscountSourceError(providerId, 'La página no tiene las secciones por ciudad (section[id^=tab-]): cambió la estructura.', pageUrl)
  const sections: ItauSection[] = []
  regions.each((_, regionElement) => {
    const region = ($(regionElement).attr('id') ?? '').replace(/^tab-/, '')
    let current: ItauSection | null = null
    let city = REGION_CITY[region] ?? ''
    // En orden de documento: títulos, párrafos y logos.
    $(regionElement).find('h2, p, [id^="restaurant-"], [id^="gourmet-"]').each((_, element) => {
      const node = $(element)
      if (element.type === 'tag' && element.tagName === 'h2') {
        const heading = cleanText(node.text())
        const kind = kindOf(heading)
        if (kind) {
          // En Interior la ciudad la da el h2 siguiente.
          city = REGION_CITY[region] ?? ''
          current = { region, city, kind, percent: null, text: '', logos: [] }
          sections.push(current)
        } else if (heading && current) {
          // Un h2 de ciudad (Interior): abre una sección igual a la actual, para esa ciudad.
          city = heading
          if (current.logos.length === 0 && !current.city) current.city = city
          else {
            current = { ...current, city, logos: [] }
            sections.push(current)
          }
        }
        return
      }
      if (!current) return
      if (element.type === 'tag' && element.tagName === 'p') {
        const text = cleanText(node.text())
        if (!text) return
        const percent = /(\d{1,3}(?:[.,]\d+)?)\s*%\s*(?:menos|de descuento|off)/i.exec(text)
        if (percent && current.percent === null) current.percent = Number(percent[1].replace(',', '.'))
        // Una nota al pie de la sección ("Los restaurantes destacados…") también es texto de la sección.
        current.text = [current.text, text].filter(Boolean).join(' ')
        return
      }
      const logo = logoOf($, element, pageUrl)
      if (logo && !current.logos.some((item) => item.name === logo.name)) current.logos.push(logo)
    })
  })
  // Secciones vacías (el bloque de Interior antes del primer h2 de ciudad).
  const filled = sections.filter((section) => section.logos.length > 0)
  if (filled.length === 0) throw new DiscountSourceError(providerId, 'La página no tiene ningún logo de restaurante ([id^=restaurant-]): cambió la estructura.', pageUrl)
  const broken = filled.find((section) => section.kind === 'restaurants' && section.percent === null)
  if (broken) throw new DiscountSourceError(providerId, `La sección de restaurantes de ${broken.city} no dice el porcentaje: cambió la estructura.`, pageUrl)
  const termsHeading = $('h3').filter((_, element) => /bases y condiciones/i.test($(element).text())).first()
  let box = termsHeading.parent()
  while (box.length && cleanText(box.text()).length < 120 && box.parent().length) box = box.parent()
  // Un renglón por párrafo: sin eso queda "01/12/202625% menos" y no se lee la fecha.
  const terms = termsHeading.length ? textWithBreaks($, box).replace(/^bases y condiciones\s*/i, '').trim() || null : null
  return { sections: filled, terms }
}
