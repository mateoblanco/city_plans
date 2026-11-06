import type { DiscountBenefit, DiscountRunError } from '../../../src/types/discounts.ts'
import { DiscountSourceError } from '../errors.ts'
import { departmentsIn, isMontevideo } from '../geo.ts'
import { benefitId, dedupeBenefitIds, sourceSlug, type ProviderReader, type ReadPlace } from '../reader.ts'
import type { StructuredBenefit } from '../structure-benefits.ts'
import { cleanText, fold, parseCap, parseDays } from '../text.ts'
import { modeOf, normalizeTier, parseBbvaDetail, validityEnd, type BbvaBenefitLine, type BbvaDetail, type BbvaLegalClause } from './parse-detail.ts'
import { parseBbvaListing, type BbvaListingCard } from './parse-listing.ts'

const sameTiers = (a: string[], b: string[]) => {
  const left = new Set(a.map(fold))
  return b.some((tier) => left.has(fold(tier)))
}

const sameTerms = (a: BbvaLegalClause, b: BbvaLegalClause) =>
  a.percent === b.percent && a.instantPercent === b.instantPercent && a.refundPercent === b.refundPercent && a.cap === b.cap

/** El párrafo legal de una línea: mismo tipo de tarjeta y algún nivel en común; si no, el único de ese tipo y porcentaje. */
export function clauseFor(line: Pick<BbvaBenefitLine, 'cardType' | 'cardTiers' | 'percent'>, clauses: BbvaLegalClause[]): BbvaLegalClause | null {
  const ofType = clauses.filter((clause) => clause.cardType === line.cardType)
  if (line.cardTiers.length > 0) {
    const byTier = ofType.filter((clause) => sameTiers(clause.cardTiers, line.cardTiers))
    if (byTier.length === 1) return byTier[0]
    // Una línea para varios niveles con párrafos iguales ("15% … Internacional, …, Platinum, Black e Infinite").
    if (byTier.length > 1 && byTier.every((clause) => sameTerms(clause, byTier[0]))) return { ...byTier[0], cardTiers: byTier.flatMap((clause) => clause.cardTiers) }
  }
  if (ofType.length === 1) return ofType[0]
  const byPercent = ofType.filter((clause) => clause.percent === line.percent)
  return byPercent.length === 1 ? byPercent[0] : null
}

/** "Carnicería en Pocitos, Montevideo" → rubro y lugar. */
export function splitSubtitle(subtitle: string | null): { category: string | null; city: string | null } {
  if (!subtitle) return { category: null, city: null }
  const text = cleanText(subtitle)
  // "Cocina de Fuegos | Buena Coctelería | Música en Vivo", "Cine • Libros • Café": un lema, no un lugar.
  if (/[|•·]/.test(text)) return { category: null, city: null }
  const index = text.toLowerCase().lastIndexOf(' en ')
  if (index < 0) return { category: text, city: null }
  return { category: text.slice(0, index).trim() || null, city: text.slice(index + 4).trim() || null }
}

function legalNeedsModel(detail: BbvaDetail, line: BbvaBenefitLine): boolean {
  const clause = detail.legal ? clauseFor(line, detail.legal.clauses) : null
  // Hay legales con un párrafo para esta tarjeta pero las reglas no sacaron cómo se aplica.
  return Boolean(clause && modeOf(clause) === 'unknown')
}

/** Arma los beneficios de un detalle; lo que las reglas no leen va al modelo (si hay). */
export async function benefitsOf(
  placeId: string,
  detail: BbvaDetail,
  structure: ((text: string) => Promise<{ benefits: StructuredBenefit[]; costUsd: number; cached: boolean }>) | undefined,
  llm: { calls: number; costUsd: number },
): Promise<{ benefits: DiscountBenefit[]; issues: string[] }> {
  const issues: string[] = []
  const legal = detail.legal
  const validFrom = legal?.validFrom ?? null
  const validTo = legal?.validTo ?? validityEnd(detail.validityText)
  const conditions = [...detail.scope, ...(legal?.conditions ?? [])].join('\n') || null
  const sharedText = [...detail.scope, ...(legal?.conditions ?? []), legal?.campaignText ?? ''].join(' ')
  const benefits: DiscountBenefit[] = []

  for (const line of detail.lines) {
    const clause = legal ? clauseFor(line, legal.clauses) : null
    const days = parseDays([line.text, clause?.text ?? '', sharedText].join(' '))
    benefits.push({
      id: benefitId(placeId, line.cardType, line.cardTiers, line.cardProgram),
      percent: line.percent,
      cardType: line.cardType,
      cardTiers: line.cardTiers,
      cardProgram: line.cardProgram,
      days: days.days,
      daysText: days.daysText,
      mode: modeOf(clause),
      instantPercent: clause?.instantPercent ?? null,
      refundPercent: clause?.refundPercent ?? null,
      cap: parseCap(clause?.cap ?? null),
      validFrom,
      validTo,
      conditions,
      sourceText: [line.text, clause?.text].filter(Boolean).join('\n'),
      parsedBy: 'html',
      sourceUrl: null,
    })
    if (!clause) issues.push(`Sin párrafo legal para «${line.text}»: modalidad y tope sin dato.`)
    else if (clause.percent !== null && clause.percent !== line.percent) issues.push(`«${line.text}» dice ${line.percent}% y el legal ${clause.percent}%.`)
  }

  // Texto libre: líneas de descuento con otra forma, o legales que las reglas no leen.
  const pending = [...detail.unparsedLines, ...detail.lines.filter((line) => legalNeedsModel(detail, line)).map((line) => line.text)]
  if (pending.length > 0) {
    if (!structure) {
      issues.push(`Sin modelo configurado: no se leyó ${pending.map((text) => `«${text}»`).join(', ')}.`)
    } else {
      const text = [`Descuentos: ${pending.join(' / ')}`, ...(legal ? [legal.campaignText ?? '', ...legal.clauses.map((clause) => clause.text)] : [])].filter(Boolean).join('\n')
      const result = await structure(text)
      if (!result.cached) {
        llm.calls += 1
        llm.costUsd += result.costUsd
      }
      for (const structured of result.benefits) {
        const raw = { ...structured, cardTiers: structured.cardTiers.map(normalizeTier) }
        const id = benefitId(placeId, raw.cardType, raw.cardTiers)
        const days = raw.daysText ? parseDays(raw.daysText) : parseDays(sharedText)
        const benefit: DiscountBenefit = {
          id,
          percent: raw.percent,
          cardType: raw.cardType,
          cardTiers: raw.cardTiers,
          cardProgram: null,
          days: days.days,
          daysText: raw.daysText ?? days.daysText,
          mode: modeOf({ percent: raw.percent, instantPercent: raw.instantPercent, refundPercent: raw.refundPercent }),
          instantPercent: raw.instantPercent,
          refundPercent: raw.refundPercent,
          cap: parseCap(raw.cap),
          validFrom,
          validTo,
          conditions,
          sourceText: text,
          parsedBy: 'llm',
          sourceUrl: null,
        }
        // Completa el beneficio que ya leyeron las reglas (mismo tipo, porcentaje y algún nivel en común), o se suma.
        const existing = benefits.findIndex((item) => item.cardType === raw.cardType && item.percent === raw.percent
          && (item.cardTiers.length === 0 || raw.cardTiers.length === 0 || sameTiers(item.cardTiers, raw.cardTiers)))
        if (existing >= 0) benefits[existing] = { ...benefits[existing], ...benefit, id: benefits[existing].id, cardTiers: benefits[existing].cardTiers, cardProgram: benefits[existing].cardProgram, sourceText: benefits[existing].sourceText }
        else benefits.push(benefit)
      }
    }
  }
  return { benefits: dedupeBenefitIds(benefits), issues }
}

function placeFrom(card: BbvaListingCard, detail: BbvaDetail | null): ReadPlace {
  const id = `bbva:${sourceSlug(card.detailUrl)}`
  const subtitle = detail?.subtitle ?? card.preheadline
  const { category, city } = splitSubtitle(subtitle)
  const areas = detail?.locations.map((location) => location.area) ?? []
  // Las direcciones no cuentan: "Bv. Artigas" o "esq. Canelones" son calles de Montevideo.
  const departments = departmentsIn([...card.tags, ...(detail?.locations.flatMap((location) => location.department ?? []) ?? [])], [city])
  return {
    id,
    providerId: 'bbva',
    sourceName: detail?.name ?? card.name,
    category,
    city,
    departments,
    montevideo: isMontevideo(departments, [city, ...areas]),
    locations: detail?.locations ?? [],
    website: detail?.website ?? null,
    instagram: detail?.instagram ?? null,
    sourceUrl: card.detailUrl,
    logoUrl: card.logoUrl ?? detail?.logoUrl ?? null,
    description: subtitle,
    sourceTags: card.tags,
    campaign: {
      validFrom: detail?.legal?.validFrom ?? null,
      validTo: detail?.legal?.validTo ?? validityEnd(detail?.validityText ?? null),
      text: detail?.legal?.campaignText ?? detail?.validityText ?? null,
    },
    benefits: [],
  }
}

/** Todas las páginas del listado y el detalle de cada lugar, de a un pedido. */
export const readBbva: ProviderReader = async ({ provider, fetcher, structure, onProgress }) => {
  onProgress?.({ phase: 'listing', done: 0, total: null })
  const first = parseBbvaListing(await fetcher.get(provider.sourceUrl), provider.sourceUrl)
  const pageUrls = first.pageUrls
  const cards = new Map<string, BbvaListingCard>()
  const add = (list: BbvaListingCard[]) => list.forEach((card) => cards.has(card.detailUrl) || cards.set(card.detailUrl, card))
  add(first.cards)
  onProgress?.({ phase: 'listing', done: 1, total: pageUrls.length })
  const firstUrl = new URL(provider.sourceUrl).toString()
  let done = 1
  for (const url of pageUrls) {
    if (url === firstUrl) continue
    // Una página del listado que no carga o cambió deja la lista incompleta: es un error del proveedor.
    add(parseBbvaListing(await fetcher.get(url), url).cards)
    done += 1
    onProgress?.({ phase: 'listing', done, total: pageUrls.length })
  }
  if (cards.size === 0) throw new DiscountSourceError(provider.id, 'El listado no trajo ningún lugar.', provider.sourceUrl)

  const places: ReadPlace[] = []
  const errors: DiscountRunError[] = []
  const warnings: string[] = []
  const llm = { calls: 0, costUsd: 0 }
  let index = 0
  for (const card of cards.values()) {
    onProgress?.({ phase: 'details', done: index, total: cards.size })
    index += 1
    let detail: BbvaDetail | null = null
    try {
      detail = parseBbvaDetail(await fetcher.get(card.detailUrl), card.detailUrl)
    } catch (error) {
      // Error parcial: el lugar queda con lo del listado y sin beneficios.
      errors.push({ providerId: provider.id, url: card.detailUrl, message: error instanceof Error ? error.message : String(error) })
    }
    const place = placeFrom(card, detail)
    if (detail) {
      try {
        const { benefits, issues } = await benefitsOf(place.id, detail, structure, llm)
        // Todos salen del detalle del lugar.
        place.benefits = benefits.map((benefit) => ({ ...benefit, sourceUrl: card.detailUrl }))
        for (const issue of issues) warnings.push(`${place.sourceName}: ${issue}`)
        for (const section of detail.unknownSections) warnings.push(`${place.sourceName}: sección sin leer «${section.slice(0, 120)}»`)
      } catch (error) {
        errors.push({ providerId: provider.id, url: card.detailUrl, message: `No se pudieron estructurar los beneficios: ${error instanceof Error ? error.message : String(error)}` })
      }
      if (place.benefits.length === 0) errors.push({ providerId: provider.id, url: card.detailUrl, message: `«${place.sourceName}» no tiene beneficios legibles.` })
    }
    places.push(place)
  }
  onProgress?.({ phase: 'details', done: cards.size, total: cards.size })
  // Ningún detalle con beneficios: cambió la estructura, no es que no haya descuentos.
  if (places.every((place) => place.benefits.length === 0)) {
    throw new DiscountSourceError(provider.id, `Ninguno de los ${places.length} detalles tiene beneficios legibles: cambió la estructura. Primer error: ${errors[0]?.message ?? '—'}`, provider.sourceUrl)
  }
  // Sin beneficios leídos (el detalle falló o no se pudo estructurar) es "no pude leer", con su error parcial.
  const unread = places.filter((place) => place.benefits.length === 0).map((place) => place.id)
  return { places, unread, errors, warnings, llm }
}
