import { load } from 'cheerio'
import type { BenefitCap, BenefitMode, ProviderPlaceLocation } from '../../../src/types/discounts.ts'
import { DiscountSourceError } from '../errors.ts'
import { montevideoNeighborhood } from '../geo.ts'
import { cleanText, fold, parseCap } from '../text.ts'
import { textWithBreaks } from './parse-listing.ts'

export type SantanderDetail = {
  name: string
  /** Los párrafos del body que no son condiciones (la presentación del local). */
  description: string | null
  /** Los bullets "•" del body, texto original. */
  conditions: string[]
  mode: BenefitMode
  cap: BenefitCap | null
  locations: ProviderPlaceLocation[]
}

const BULLET = /^[•·\-–]\s*/

/** "…/maps/dir//-34.910066,-56.1498038" → coordenadas. */
export function coordinatesOf(url: string | undefined): { lat: number; lng: number } | null {
  const match = url ? /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(decodeURIComponent(url)) : null
  if (!match) return null
  const lat = Number(match[1])
  const lng = Number(match[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

/** Reintegro en el estado de cuenta o descuento en el punto de venta. */
export function modeOfConditions(conditions: string[]): BenefitMode {
  const text = fold(conditions.join(' '))
  // "Tope de devolución" o "devolución de puntos de IVA" no dicen cómo se aplica el descuento.
  const refund = /estado de cuenta|reintegro/.test(text)
  const instant = /punto de venta|en caja|en el momento/.test(text)
  if (refund && instant) return 'mixed'
  if (refund) return 'refund'
  if (instant) return 'instant'
  return 'unknown'
}

/**
 * El tope de "Tope de Devolución mensual": si cambia por segmento (Private Banking, Select, el resto), un texto con
 * todos los montos y amount en null; con un solo monto, parseCap.
 */
export function capOfConditions(conditions: string[]): BenefitCap | null {
  const paragraph = conditions.find((condition) => /\btope\b/i.test(condition))
  if (!paragraph) return null
  const folded = fold(paragraph)
  if (/sin tope/.test(folded)) return { text: 'Sin tope', amount: null, currency: null, period: null }
  const monthly = /mensual|por mes/.test(folded)
  const segments = [...paragraph.matchAll(/(?:segmento\s+([^:\n]+?)|(resto de los segmentos))\s*:\s*hasta\s+(UYU|U\$S|USD|\$U?)\s*([\d.]+(?:,\d+)?)/gi)]
    .map((match) => ({ name: match[2] ? 'resto' : cleanText(match[1]), currency: match[3], amount: match[4] }))
  const amounts = new Set(segments.map((segment) => segment.amount))
  if (segments.length > 1 && amounts.size > 1) {
    const byType = /tarjetas de credito.{0,120}?tarjetas de debito/.test(folded) ? ' (crédito y débito por separado)' : ''
    const text = `${segments.map((segment, index) => `${segment.name}${index === 0 ? ' hasta' : ''} ${segment.currency} ${segment.amount}`).join(', ')}${monthly ? ' por mes' : ''}${byType}`
    const currencies = new Set(segments.map((segment) => (/u\$s|usd/i.test(segment.currency) ? 'USD' : 'UYU')))
    return { text, amount: null, currency: currencies.size === 1 ? [...currencies][0] as 'UYU' | 'USD' : null, period: monthly ? 'month' : null }
  }
  const parsed = parseCap(paragraph.replace(/^.*?tope[^:]*:?/i, '').trim() || paragraph)
  return parsed && monthly && !parsed.period ? { ...parsed, period: 'month' } : parsed
}

/** El detalle de un lugar (/beneficios/<slug>). Falla si no está el artículo o su body. */
export function parseSantanderDetail(html: string, url: string): SantanderDetail {
  const $ = load(html)
  const article = $('article.node--view-mode-full').first()
  const body = article.find('.field--name-body').first()
  if (article.length === 0 || body.length === 0) {
    throw new DiscountSourceError('santander', 'El detalle no tiene el artículo del beneficio (node--view-mode-full) o su texto: cambió la estructura.', url)
  }
  const name = cleanText(article.find('.field--name-title').first().text() || article.find('h3').first().text())
  const paragraphs = textWithBreaks($, body).split('\n')
  // Un bullet sigue en los renglones siguientes hasta el próximo bullet (el tope lista los segmentos en renglones).
  const conditions: string[] = []
  const description: string[] = []
  for (const line of paragraphs) {
    if (BULLET.test(line)) conditions.push(line.replace(BULLET, ''))
    else if (conditions.length) conditions[conditions.length - 1] += `\n${line}`
    else description.push(line)
  }
  const locations = article.find('[id^="branches-"] article').toArray().flatMap((element): ProviderPlaceLocation[] => {
    const node = $(element)
    const title = cleanText(node.find('h3, h4, h5').first().text())
    const mapsUrl = node.find('a[href*="google.com/maps"], a[href*="maps.google"], a[href*="goo.gl"]').first().attr('href') ?? null
    // La dirección tiene su campo; el teléfono va aparte y no se guarda.
    const address = cleanText(node.find('.field--name-field-ubicacion').first().text())
    if (!address && !title) return []
    // "Nora Rey - Pocitos": lo de después del guion es la sucursal; si es un barrio, sirve como área.
    const branch = title.includes(' - ') ? cleanText(title.slice(title.lastIndexOf(' - ') + 3)) : null
    return [{
      address: address || title,
      area: branch && montevideoNeighborhood(branch) ? branch : null,
      department: null,
      mapsUrl,
      coordinates: coordinatesOf(mapsUrl ?? undefined),
    }]
  })
  // Sin bullets (Cali Café: "El descuento se efectúa en el punto de venta. Descuento no acumulable…"), todo el texto
  // es a la vez presentación y condiciones: de ahí salen la modalidad y el tope.
  const terms = conditions.length ? conditions : description.length ? [description.join(' ')] : []
  return {
    name,
    description: description.join(' ') || null,
    conditions: terms,
    mode: modeOfConditions(terms),
    cap: capOfConditions(terms),
    locations,
  }
}
