import type { BenefitMode, DiscountBenefit } from '../../../src/types/discounts.ts'
import type { DiscountProvider } from '../providers.ts'
import { DiscountSourceError } from '../errors.ts'
import { departmentsIn } from '../geo.ts'
import { benefitId, dedupeBenefitIds, type ProviderReader, type ReadPlace } from '../reader.ts'
import { normalizeTier } from '../bbva/parse-detail.ts'
import { mentionsDebit } from '../santander/benefit-text.ts'
import { cleanText, fold, parseDays, validityOf } from '../text.ts'
import { parseItauSectionText } from './benefit-text.ts'
import { parseItauPage, type ItauSection } from './parse-page.ts'

/** Las páginas del proveedor: `pages` o, si no hay, la única `sourceUrl`. */
export const providerPages = (provider: DiscountProvider) => provider.pages ?? [{ url: provider.sourceUrl, label: provider.name }]

// Departamento de cada ciudad que usa Itaú (Punta del Este es Maldonado; el resto, por nombre).
const CITY_DEPARTMENT: Record<string, string> = { 'punta del este': 'Maldonado', mercedes: 'Soriano' }

const slug = (value: string) => fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export type ItauTerms = { text: string; validFrom: string | null; validTo: string | null; mode: BenefitMode }

/**
 * Las bases de una región. Platinum las parte ("Punta del este - Vigencia…", "Montevideo e interior - Vigencia…");
 * las demás, una sola para todas.
 */
export function termsFor(terms: string | null, region: string): ItauTerms | null {
  if (!terms) return null
  // Cada región empieza un renglón ("Montevideo e interior - Vigencia…"); no se corta en el "interior" de adentro.
  const parts = terms.split(/\n(?=\s*(?:Punta del este|Montevideo e interior|Montevideo|Interior)\s*-\s*Vigencia)/i).map(cleanText).filter(Boolean)
  const wanted = region === 'pde' ? /^punta del este/ : region === 'mvd' ? /^montevideo/ : /^(montevideo e interior|interior)/
  const text = parts.length > 1 ? parts.find((part) => wanted.test(fold(part))) ?? cleanText(terms) : cleanText(terms)
  const validity = validityOf(text)
  const folded = fold(text)
  const mode: BenefitMode = /al momento de la compra|en el momento|punto de venta/.test(folded) ? 'instant' : /estado de cuenta|reintegro/.test(folded) ? 'refund' : 'unknown'
  return { text, validFrom: validity?.validFrom ?? null, validTo: validity?.validTo ?? null, mode }
}

/** Las páginas de restaurantes de Itaú (Restaurantes, Platinum, Personal Bank): un lugar por ciudad y nombre. */
export const readItau: ProviderReader = async ({ provider, fetcher, structure, onProgress }) => {
  const pages = providerPages(provider)
  const places = new Map<string, ReadPlace>()
  const notes: string[] = []
  const warnings: string[] = []
  const llm = { calls: 0, costUsd: 0 }
  let byRules = 0
  let byModel = 0
  for (const [index, page] of pages.entries()) {
    onProgress?.({ phase: 'listing', done: index, total: pages.length })
    // Una página que no carga o cambió deja lugares sin ver: es un error del proveedor (no se marca nada inactivo).
    const parsed = parseItauPage(await fetcher.get(page.url), page.url, provider.id)
    const gourmet = parsed.sections.filter((section) => section.kind === 'gourmet')
    if (gourmet.length) notes.push(`${page.label}: ${gourmet.reduce((total, section) => total + section.logos.length, 0)} tiendas gourmet (no se guardan).`)
    const cache = new Map<string, Awaited<ReturnType<typeof sectionBenefits>>>()
    for (const section of parsed.sections.filter((item) => item.kind === 'restaurants')) {
      const terms = termsFor(parsed.terms, section.region)
      const key = `${section.region}|${section.percent}|${section.text}`
      // Las secciones con el mismo texto (las ciudades del Interior) se leen una vez.
      if (!cache.has(key)) {
        const read = await sectionBenefits(section, terms, structure, llm)
        for (const issue of read.issues) warnings.push(`${page.label} (${section.city}): ${issue}`)
        cache.set(key, read)
      }
      const { rules: read, model } = cache.get(key)!
      // Con `cards`, la página dice qué tarjetas le da a este proveedor; lo demás sale de la primera regla leída.
      const rules = page.cards && read[0] ? page.cards.map((card) => ({ ...read[0], cardType: card.cardType, cardTiers: [...card.cardTiers] })) : read
      if (page.cards && !read[0]) warnings.push(`${page.label} (${section.city}): no se leyó el beneficio de «${section.text}».`)
      const montevideo = section.region === 'mvd'
      for (const logo of section.logos) {
        const id = `${provider.id}:${slug(section.city)}:${slug(logo.name)}`
        const place = places.get(id) ?? {
          id,
          providerId: provider.id,
          sourceName: logo.name,
          category: null,
          city: section.city,
          departments: CITY_DEPARTMENT[fold(section.city)] ? [CITY_DEPARTMENT[fold(section.city)]] : departmentsIn([section.city], []),
          montevideo,
          // Sin direcciones: para cadenas aplica la regla de toda la marca.
          locations: [],
          website: logo.website,
          instagram: logo.instagram,
          sourceUrl: page.url,
          logoUrl: logo.logoUrl,
          description: null,
          sourceTags: [],
          campaign: { validFrom: null, validTo: null, text: null },
          benefits: [],
        }
        place.instagram ??= logo.instagram
        place.website ??= logo.website
        if (!place.sourceTags.includes(page.label)) place.sourceTags.push(page.label)
        // La vigencia de la campaña: la de la primera página que la da.
        if (!place.campaign.text && terms) place.campaign = { validFrom: terms.validFrom, validTo: terms.validTo, text: terms.text }
        for (const rule of rules) {
          place.benefits.push({ ...rule, sourceUrl: page.url, id: benefitId(id, rule.cardType, rule.cardTiers) })
          if (model) byModel += 1
          else byRules += 1
        }
        places.set(id, place)
      }
    }
  }
  onProgress?.({ phase: 'listing', done: pages.length, total: pages.length })
  if (places.size === 0) throw new DiscountSourceError(provider.id, 'Las páginas no trajeron ningún restaurante.', provider.sourceUrl)
  for (const place of places.values()) place.benefits = dedupeBenefitIds(place.benefits)
  notes.unshift(`Beneficios: ${byRules} por reglas, ${byModel} por el modelo.`)
  for (const page of pages) {
    const count = [...places.values()].filter((place) => place.sourceTags.includes(page.label)).length
    notes.push(`${page.label}: ${count} restaurantes.`)
  }
  return { places: [...places.values()], unread: [], errors: [], warnings, notes, llm }
}

/** Los beneficios (sin id) de una sección: con reglas; si el texto no dice el tipo de tarjeta, con el modelo. */
async function sectionBenefits(
  section: ItauSection,
  terms: ItauTerms | null,
  structure: Parameters<ProviderReader>[0]['structure'],
  llm: { calls: number; costUsd: number },
): Promise<{ rules: Omit<DiscountBenefit, 'id'>[]; issues: string[]; model: boolean }> {
  const percent = section.percent!
  const mode = terms?.mode ?? 'unknown'
  const common = {
    percent,
    cardProgram: null,
    mode,
    instantPercent: mode === 'instant' ? percent : null,
    refundPercent: mode === 'refund' ? percent : null,
    cap: null,
    validFrom: terms?.validFrom ?? null,
    validTo: terms?.validTo ?? null,
    conditions: terms?.text ?? null,
    sourceText: section.text,
    sourceUrl: null as string | null,
  }
  const rules = parseItauSectionText(section.text)
  if (rules) return { rules: rules.map((rule) => ({ ...common, ...rule, parsedBy: 'html' as const })), issues: [], model: false }
  if (!structure) return { rules: [], issues: [`Sin modelo configurado: no se leyó «${section.text}».`], model: false }
  const result = await structure(section.text)
  if (!result.cached) {
    llm.calls += 1
    llm.costUsd += result.costUsd
  }
  const issues: string[] = []
  const benefits = result.benefits.flatMap((raw) => {
    if (raw.cardType === 'debit' && !mentionsDebit(section.text)) {
      issues.push(`El modelo propuso un débito que «${section.text}» no dice: descartado.`)
      return []
    }
    const days = raw.daysText ? parseDays(raw.daysText) : parseDays(section.text)
    return [{ ...common, percent: raw.percent || percent, cardType: raw.cardType, cardTiers: raw.cardTiers.map(normalizeTier), days: days.days, daysText: raw.daysText ?? days.daysText, parsedBy: 'llm' as const }]
  })
  return { rules: benefits, issues, model: true }
}
