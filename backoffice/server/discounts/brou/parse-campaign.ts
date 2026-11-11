import * as cheerio from 'cheerio'
import type { Element } from 'domhandler'
import type { BenefitMode, CardType, DiscountBenefit } from '../../../src/types/discounts.ts'
import { DiscountSourceError } from '../errors.ts'
import { cleanText, fold, numericDate, parseCap, parseDays, validityOf } from '../text.ts'

/** Un beneficio de la campaña, igual para todos los locales (el id y la página se ponen por lugar). */
export type CampaignBenefit = Omit<DiscountBenefit, 'id' | 'sourceUrl'>

export type BrouCampaign = {
  title: string
  /** El link al listado de locales (el nombre del PDF cambia: se toma de la página). */
  pdfUrl: string
  benefits: CampaignBenefit[]
  /** Líneas con un porcentaje que las reglas no leyeron: van al modelo. */
  pending: string[]
  validFrom: string | null
  validTo: string | null
  mode: BenefitMode
  conditions: string | null
  /** El texto de la campaña (bajo el título), para `campaign.text`. */
  text: string | null
  warnings: string[]
}

// "BROU VISA Platinum e Infinite" → Visa; "BROU Recompensa Mastercard Platinum y Black" → Mastercard Recompensa.
const BRANDS: [RegExp, string][] = [
  [/^(?:recompensa\s+mastercard|mastercard\s+recompensa)\b/i, 'Mastercard Recompensa'],
  [/^visa\b/i, 'Visa'],
  [/^mastercard\b/i, 'Mastercard'],
]

const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()

/**
 * "BROU VISA Platinum e Infinite y BROU Recompensa Mastercard Platinum y Black" → Visa Platinum, Visa Infinite,
 * Mastercard Recompensa Platinum, Mastercard Recompensa Black. Sin niveles ("BROU VISA y BROU Recompensa Mastercard"):
 * la marca sola. null si aparece una marca que no conocemos (la línea va al modelo).
 */
export function brouCardTiers(text: string): string[] | null {
  const segments = cleanText(text).split(/\bBROU\b/i).map((part) => part.trim().replace(/^(?:y|e|,)\s+|\s+(?:y|e|,)$/gi, '').trim()).filter(Boolean)
  if (segments.length === 0) return null
  const tiers: string[] = []
  for (const segment of segments) {
    const brand = BRANDS.find(([pattern]) => pattern.test(segment))
    if (!brand) return null
    const rest = segment.replace(brand[0], '').trim()
    if (!rest) {
      tiers.push(brand[1])
      continue
    }
    for (const tier of rest.split(/\s*,\s*|\s+y\s+|\s+e\s+/i).map((part) => part.trim()).filter(Boolean)) {
      tiers.push(`${brand[1]} ${tier.split(/\s+/).map(titleCase).join(' ')}`)
    }
  }
  return tiers
}

// "30% de descuento con tarjetas de crédito BROU VISA … Tope mensual: $3.000 por cuenta. Aplica todos los días."
const BENEFIT_LINE = /^(\d{1,3})\s*%\s*de descuento con tarjetas de (cr[eé]dito|d[eé]bito)\s+(.+?)\.\s*(Tope[^.]*?(?:\d\.\d{3}[^.]*?)*)\.\s*(Aplica\b.*?)\.?$/i

/** Una línea de beneficio leída con reglas; null si no tiene la forma de siempre. */
export function parseBenefitLine(line: string, mode: BenefitMode): CampaignBenefit | null {
  const match = BENEFIT_LINE.exec(cleanText(line))
  if (!match) return null
  const percent = Number(match[1])
  if (!(percent > 0 && percent <= 100)) return null
  const cardType: CardType = fold(match[2]).startsWith('debito') ? 'debit' : 'credit'
  const cardTiers = brouCardTiers(match[3])
  if (!cardTiers) return null
  const cap = parseCap(match[4].replace(/\s*:\s*/, ': '))
  const days = parseDays(`${match[5]}.`)
  if (days.days === null) return null
  return {
    percent,
    cardType,
    cardTiers,
    cardProgram: null,
    days: days.days,
    daysText: days.daysText,
    mode,
    instantPercent: mode === 'instant' ? percent : null,
    refundPercent: mode === 'refund' ? percent : null,
    cap,
    validFrom: null,
    validTo: null,
    conditions: null,
    sourceText: cleanText(line),
    parsedBy: 'html',
  }
}

/**
 * Modalidad de la línea de condiciones. "El descuento se acredita en la cuenta al cierre del estado de cuenta" =
 * reintegro. La variante "Si se paga a través de BROU A MANO Comercios, …" no se toma en cuenta.
 */
export function campaignMode(lines: string[]): { mode: BenefitMode; line: string | null } {
  for (const line of lines) {
    const sentences = cleanText(line).split(/(?<=\.)\s+/).filter((sentence) => !/brou a mano/i.test(fold(sentence)))
    const folded = fold(sentences.join(' '))
    if (/se acredita/.test(folded) && /estado de cuenta|cierre/.test(folded)) return { mode: 'refund', line }
    if (/(?:al|en el) momento de la compra|en la factura/.test(folded)) return { mode: 'instant', line }
  }
  return { mode: 'unknown', line: null }
}

const isPdfHref = (href: string) => /\.pdf(?:[?#]|$)/i.test(href)

/** Lee la página de una campaña: el link al PDF, los beneficios, la vigencia y las condiciones. */
export function parseBrouCampaign(html: string, pageUrl: string, providerId = 'brou'): BrouCampaign {
  const $ = cheerio.load(html)
  const warnings: string[] = []
  const title = cleanText($('h1').first().text())

  // El link al PDF, en el cuerpo de la campaña (no en "También te puede interesar").
  const links = $('.condiciones1 a[href]').toArray()
    .map((element) => ({ href: $(element).attr('href') ?? '', text: cleanText($(element).text()) }))
    .filter((link) => isPdfHref(link.href))
  if (links.length === 0) throw new DiscountSourceError(providerId, `La página de la campaña «${title || pageUrl}» no tiene el link al PDF con los locales adheridos (¿cambió la página?).`, pageUrl)
  const preferred = links.filter((link) => /locales|listado|adherid/i.test(link.text))
  const chosen = (preferred.length ? preferred : links)[0]
  if ((preferred.length || links.length) > 1) warnings.push(`La campaña «${title}» tiene ${links.length} PDFs; se usa «${chosen.text}».`)
  const pdfUrl = new URL(chosen.href, pageUrl).toString()

  // Condiciones: un <li> por cosa; las excepciones, en otra lista después de "Excepciones:".
  const body = $('.condiciones1 .accordion-body').first()
  if (body.length === 0) throw new DiscountSourceError(providerId, `La campaña «${title}» no tiene el bloque de condiciones (¿cambió la página?).`, pageUrl)
  const groups = body.find('ul').toArray().map((list) => ({ label: labelBefore(list), items: $(list).children('li').toArray().map((item) => cleanText($(item).text())).filter(Boolean) }))
  const lines = groups.flatMap((group) => group.items)

  const vigencia = lines.find((line) => /^vigencia\b/i.test(line)) ?? null
  const validity = vigencia ? validityOf(vigencia) : null
  if (!validity?.validTo) warnings.push(`La campaña «${title}» no tiene la vigencia en las condiciones.`)
  const header = cleanText($('.info-beneficio').text())
  const headerTo = /vigencia/i.test(header) ? numericDate(header) : null
  if (headerTo && validity?.validTo && headerTo !== validity.validTo) warnings.push(`La campaña «${title}» dice vigencia ${headerTo} arriba y ${validity.validTo} en las condiciones: se usa la de las condiciones.`)

  const { mode, line: modeLine } = campaignMode(lines)
  if (mode === 'unknown') warnings.push(`La campaña «${title}» no dice si el descuento es en el momento o un reintegro.`)

  const benefitLines = lines.filter((line) => /^\d{1,3}\s*%/.test(line))
  const benefits: CampaignBenefit[] = []
  const pending: string[] = []
  for (const line of benefitLines) {
    const benefit = parseBenefitLine(line, mode)
    if (benefit) benefits.push(benefit)
    else pending.push(line)
  }

  const used = new Set([vigencia, modeLine, ...benefitLines])
  const conditionLines = groups.flatMap((group) => {
    const items = group.items.filter((item) => !used.has(item))
    return items.length ? [...(group.label ? [group.label] : []), ...items] : []
  })
  const text = cleanText($('.condiciones1 .col-12.mb-5 p').first().text().replace(/Conocé los locales adheridos acá/i, '')) || null

  return {
    title,
    pdfUrl,
    benefits: benefits.map((benefit) => ({ ...benefit, validFrom: validity?.validFrom ?? null, validTo: validity?.validTo ?? null, conditions: conditionLines.join('\n') || null })),
    pending,
    validFrom: validity?.validFrom ?? null,
    validTo: validity?.validTo ?? null,
    mode,
    conditions: conditionLines.join('\n') || null,
    text,
    warnings,
  }
}

/** El texto suelto justo antes de una lista ("Excepciones:"), si hay. */
function labelBefore(list: Element): string | null {
  let node = list.prev
  while (node) {
    if (node.type === 'text') {
      const text = cleanText((node as unknown as { data: string }).data)
      if (text) return text
    } else if (node.type === 'tag' && (node as Element).name !== 'hr') return null
    node = node.prev
  }
  return null
}
