import type { DiscountBenefit, DiscountProvider, DiscountRunError } from '../../../src/types/discounts.ts'
import { DiscountSourceError } from '../errors.ts'
import { benefitId, dedupeBenefitIds, sourceSlug, type ProviderReader, type ReadPlace } from '../reader.ts'
import type { BenefitStructurer } from '../structure-benefits.ts'
import { parseCap, parseDays } from '../text.ts'
import { normalizeTier } from '../bbva/parse-detail.ts'
import { mentionsDebit, parseSantanderBenefitText } from './benefit-text.ts'
import { parseSantanderDetail, type SantanderDetail } from './parse-detail.ts'
import { parseSantanderListing, type SantanderCard } from './parse-listing.ts'

const errorTitle = (html: string) => /<title>\s*([^<]*)</i.exec(html)?.[1]?.trim() ?? ''
/** La página de error del sitio ("Error 503 | Santander"), que a veces viene con status 200. */
export const isErrorPage = (html: string) => /^error \d{3}\b/i.test(errorTitle(html))

/** URL de una página del listado con los filtros del config (page=0 es la primera). */
export function santanderPageUrl(provider: DiscountProvider, page: number): string {
  const url = new URL(provider.sourceUrl)
  for (const [key, value] of Object.entries(provider.listing?.params ?? {})) url.searchParams.set(key, value)
  url.searchParams.set('page', String(page))
  return url.toString()
}

/** Contadores para el reporte de la corrida. */
export type SantanderStats = { pointsOnly: string[]; ignoredLines: Map<string, number>; byRules: number; byModel: number }

/**
 * Beneficios de una card: con reglas lo que se puede; las oraciones que no, al modelo (validado en código: nunca un
 * débito si la oración no lo dice). La modalidad y el tope salen del detalle, iguales para todos los del lugar.
 */
export async function santanderBenefits(
  placeId: string,
  card: SantanderCard,
  detail: SantanderDetail | null,
  structure: BenefitStructurer | undefined,
  llm: { calls: number; costUsd: number },
  stats: SantanderStats,
): Promise<{ benefits: DiscountBenefit[]; issues: string[]; points: boolean }> {
  const text = parseSantanderBenefitText(card.benefitText)
  const issues: string[] = []
  for (const line of text.ignored) stats.ignoredLines.set(line, (stats.ignoredLines.get(line) ?? 0) + 1)
  const conditions = detail?.conditions.length ? detail.conditions.join('\n') : null
  const common = { mode: detail?.mode ?? 'unknown', cap: detail?.cap ?? null, validFrom: null, validTo: null, conditions }
  const instantRefund = (percent: number) => common.mode === 'instant' ? { instantPercent: percent, refundPercent: null } : common.mode === 'refund' ? { instantPercent: null, refundPercent: percent } : { instantPercent: null, refundPercent: null }
  const benefits: DiscountBenefit[] = text.benefits.map((rule) => ({
    id: benefitId(placeId, rule.cardType, rule.cardTiers),
    percent: rule.percent,
    cardType: rule.cardType,
    cardTiers: rule.cardTiers,
    cardProgram: null,
    days: rule.days,
    daysText: rule.daysText,
    ...common,
    ...instantRefund(rule.percent),
    sourceText: rule.sourceText,
    parsedBy: 'html',
    sourceUrl: null,
  }))
  stats.byRules += benefits.length

  for (const sentence of text.pending) {
    if (!structure) {
      issues.push(`Sin modelo configurado: no se leyó «${sentence}».`)
      continue
    }
    const result = await structure(sentence)
    if (!result.cached) {
      llm.calls += 1
      llm.costUsd += result.costUsd
    }
    for (const raw of result.benefits) {
      // Validado en código: nada de débitos que la fuente no dice.
      if (raw.cardType === 'debit' && !mentionsDebit(sentence)) {
        issues.push(`El modelo propuso un débito que «${sentence}» no dice: descartado.`)
        continue
      }
      const cardTiers = raw.cardTiers.map(normalizeTier)
      const days = raw.daysText ? parseDays(raw.daysText) : parseDays(sentence)
      benefits.push({
        id: benefitId(placeId, raw.cardType, cardTiers),
        percent: raw.percent,
        cardType: raw.cardType,
        cardTiers,
        cardProgram: null,
        days: days.days,
        daysText: raw.daysText ?? days.daysText,
        ...common,
        cap: common.cap ?? parseCap(raw.cap),
        ...instantRefund(raw.percent),
        sourceText: sentence,
        parsedBy: 'llm',
        sourceUrl: null,
      })
      stats.byModel += 1
    }
  }
  return { benefits: dedupeBenefitIds(benefits), issues, points: text.points }
}

/** Todas las páginas del listado filtrado (Ruta Gourmet, Montevideo) y el detalle de cada lugar, de a un pedido. */
export const readSantander: ProviderReader = async ({ provider, fetcher, structure, onProgress }) => {
  const maxPages = provider.listing?.maxPages ?? 30
  const cards = new Map<string, SantanderCard>()
  let mapList: string[] = []
  onProgress?.({ phase: 'listing', done: 0, total: null })
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) throw new DiscountSourceError(provider.id, `El listado sigue después de ${maxPages} páginas: corto por seguridad (¿cambió la paginación?).`, santanderPageUrl(provider, page))
    const url = santanderPageUrl(provider, page)
    const listing = parseSantanderListing(await fetcher.get(url), url)
    if (page === 0) mapList = listing.mapListUrls
    for (const card of listing.cards) if (!cards.has(card.detailUrl)) cards.set(card.detailUrl, card)
    onProgress?.({ phase: 'listing', done: page + 1, total: null })
    if (listing.cards.length === 0 || !listing.nextUrl) break
  }
  if (cards.size === 0) throw new DiscountSourceError(provider.id, 'El listado no trajo ningún lugar.', santanderPageUrl(provider, 0))

  const warnings: string[] = []
  const missingFromPages = mapList.filter((url) => !cards.has(url))
  const missingFromMap = [...cards.keys()].filter((url) => mapList.length && !mapList.includes(url))
  if (missingFromPages.length || missingFromMap.length) {
    warnings.push(`El listado paginado (${cards.size}) no coincide con la lista del mapa (${mapList.length}): faltan en el paginado ${missingFromPages.map(sourceSlug).join(', ') || '—'}; faltan en el mapa ${missingFromMap.map(sourceSlug).join(', ') || '—'}.`)
  }

  const places: ReadPlace[] = []
  const unread: string[] = []
  const errors: DiscountRunError[] = []
  const llm = { calls: 0, costUsd: 0 }
  const stats: SantanderStats = { pointsOnly: [], ignoredLines: new Map(), byRules: 0, byModel: 0 }
  let index = 0
  for (const card of cards.values()) {
    onProgress?.({ phase: 'details', done: index, total: cards.size })
    index += 1
    const id = `santander:${sourceSlug(card.detailUrl)}`
    let detail: SantanderDetail | null = null
    try {
      let html = await fetcher.get(card.detailUrl)
      // Santander a veces responde una página "Error 503" con status 200: un reintento (con la pausa de siempre).
      if (isErrorPage(html)) html = await fetcher.get(card.detailUrl)
      if (isErrorPage(html)) throw new Error(`Santander respondió una página de error (${errorTitle(html)}) para ${card.detailUrl}.`)
      detail = parseSantanderDetail(html, card.detailUrl)
    } catch (error) {
      errors.push({ providerId: provider.id, url: card.detailUrl, message: error instanceof Error ? error.message : String(error) })
    }
    let benefits: DiscountBenefit[] = []
    let points = false
    try {
      const result = await santanderBenefits(id, card, detail, structure, llm, stats)
      // El texto sale de la card del listado; la modalidad y el tope, del detalle del lugar.
      benefits = result.benefits.map((benefit) => ({ ...benefit, sourceUrl: card.detailUrl }))
      points = result.points
      for (const issue of result.issues) warnings.push(`${card.name}: ${issue}`)
    } catch (error) {
      errors.push({ providerId: provider.id, url: card.detailUrl, message: `No se pudieron estructurar los beneficios: ${error instanceof Error ? error.message : String(error)}` })
    }
    // Sólo canje de puntos, sin porcentaje: por ahora no se guarda.
    if (benefits.length === 0 && points) {
      stats.pointsOnly.push(card.name)
      continue
    }
    if (benefits.length === 0 && detail) errors.push({ providerId: provider.id, url: card.detailUrl, message: `«${card.name}» no tiene beneficios legibles: «${card.benefitText}».` })
    // Sin detalle, la modalidad y el tope no se saben: no se tocan los beneficios guardados.
    if (!detail || benefits.length === 0) unread.push(id)
    places.push({
      id,
      providerId: provider.id,
      sourceName: detail?.name || card.name,
      category: null,
      // El listado está filtrado por departamento Montevideo; los locales de otros departamentos se ven por coordenadas.
      city: 'Montevideo',
      departments: ['Montevideo'],
      montevideo: true,
      locations: detail?.locations ?? [],
      website: null,
      instagram: null,
      sourceUrl: card.detailUrl,
      logoUrl: card.logoUrl,
      description: detail?.description ?? null,
      sourceTags: card.tags,
      campaign: { validFrom: null, validTo: null, text: null },
      benefits,
    })
  }
  onProgress?.({ phase: 'details', done: cards.size, total: cards.size })
  if (places.every((place) => place.benefits.length === 0)) {
    throw new DiscountSourceError(provider.id, `Ninguno de los ${places.length} lugares tiene beneficios legibles: cambió la estructura. Primer error: ${errors[0]?.message ?? '—'}`, provider.sourceUrl)
  }
  const notes = [`Beneficios: ${stats.byRules} por reglas, ${stats.byModel} por el modelo.`]
  if (stats.pointsOnly.length) notes.push(`Sólo canje de puntos, sin porcentaje (no se guardan): ${stats.pointsOnly.length} — ${stats.pointsOnly.join(', ')}.`)
  for (const [line, count] of stats.ignoredLines) notes.push(`No es un porcentaje de descuento (no se guarda): «${line}» en ${count} ${count === 1 ? 'lugar' : 'lugares'}.`)
  return { places, unread, errors, warnings, notes, llm }
}
