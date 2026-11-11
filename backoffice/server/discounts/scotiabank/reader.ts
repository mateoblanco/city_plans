import type { BenefitCap, DiscountBenefit, ProviderPlaceLocation } from '../../../src/types/discounts.ts'
import { DiscountSourceError } from '../errors.ts'
import { departmentsIn } from '../geo.ts'
import { landmarkLocation } from '../landmarks.ts'
import { montevideoToday } from '../persist.ts'
import { benefitId, dedupeBenefitIds, type ProviderReader, type ReadPlace, type ReaderContext } from '../reader.ts'
import { mentionsDebit } from '../santander/benefit-text.ts'
import { cleanText, fold, parseDays } from '../text.ts'
import { parseScotiaLine, percentClauses, percentsIn, type ScotiaCard } from './benefit-text.ts'
import { extractPushBenefits, type ScotiaBenefit, type ScotiaDiscount } from './extract.ts'
import { capsOf, decodeLegal, legalSections, legalToText, modeOf, montevideoSections } from './legal.ts'

export const BLOCKED_MESSAGE = 'Scotiabank bloqueó la lectura: la página llegó sin los beneficios (pushBenefit), también en el navegador.'

const slug = (value: string) => fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const parts = (value: string | null | undefined) => (value ?? '').split(',').map((part) => fold(part).trim()).filter(Boolean)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Lo que Scotiabank pone como departamento y no es uno ("punta del este").
const CITY_DEPARTMENT: Record<string, string> = { 'punta del este': 'Maldonado', mercedes: 'Soriano' }

/** Restaurantes o cafeterías de Montevideo, sin The Platinum Card (platinumcard) ni los "nacional" o sin departamento. */
export function isWanted(benefit: ScotiaBenefit): boolean {
  const categories = parts(benefit.categoria)
  if (!categories.some((category) => category === 'restaurantes' || category === 'cafeteria')) return false
  if (categories.includes('platinumcard')) return false
  const departments = parts(benefit.departamento)
  return departments.includes('montevideo') && !departments.includes('nacional')
}

/** Como `isVigente` de la página: desde ≤ hoy ≤ hasta (una fecha que no se lee no cuenta). */
export function vigency(range: { desde?: string | null; hasta?: string | null }, today: string): 'current' | 'expired' | 'future' {
  if (range.desde && ISO_DATE.test(range.desde) && today < range.desde) return 'future'
  if (range.hasta && ISO_DATE.test(range.hasta) && today > range.hasta) return 'expired'
  return 'current'
}

const dateOrNull = (value: string | null | undefined) => (value && ISO_DATE.test(value.trim()) ? value.trim() : null)

/** "custom:Todos los días" → "Todos los días"; "Lunes a viernes" → "de lunes a viernes" (lo que lee `parseDays`). */
function daysOf(raw: string | null | undefined) {
  const text = cleanText((raw ?? '').replace(/^custom:/i, ''))
  if (!text) return { days: null, daysText: null }
  const range = /^(lunes|martes|miercoles|jueves|viernes|sabado|domingo)s? a /i.test(fold(text)) ? `de ${text}` : text
  const parsed = parseDays(range)
  return { days: parsed.days, daysText: text }
}

/** Lo que está en **negrita** en el texto (los lugares: "Punta Carretas Shopping, Mercado Agrícola y Punta Shopping"). */
const boldParts = (texto: string) => [...texto.matchAll(/\*\*(.+?)\*\*/g)].flatMap((match) => match[1].split(/\s*,\s*|\s+y\s+/)).map(cleanText).filter(Boolean)

function locationOf(name: string): ProviderPlaceLocation {
  const known = landmarkLocation(name)
  return { address: name, area: known?.area ?? null, department: known?.department ?? null, mapsUrl: null }
}

const lineText = (item: ScotiaDiscount) => cleanText(`${item.pct ?? ''} ${(item.texto ?? '').replace(/\*\*/g, '')}`)

type Line = { pct: string; texto: string; source: string }

/** Las bases: texto, modalidad y topes (de las secciones de Montevideo si las bases vienen por sucursal). */
function termsOf(rawLegal: string) {
  const html = decodeLegal(rawLegal)
  const text = legalToText(html)
  if (!text) return { text: null, mode: 'unknown' as const, caps: { premium: null, rest: null } }
  const mvd = montevideoSections(legalSections(html)).map((section) => section.text).join('\n')
  return { text, mode: modeOf(mvd), caps: capsOf(mvd) }
}

/** Los beneficios de Scotiabank: todos en la página, sin paginar. */
export const readScotiabank: ProviderReader = async (context) => {
  const { provider, fetcher, onProgress } = context
  const url = provider.sourceUrl
  onProgress?.({ phase: 'listing', done: 0, total: 1 })
  // Primero un pedido normal; si llega sin los datos (Akamai), la página renderizada en un navegador.
  let html: string | null = null
  let method = 'pedido normal'
  let extracted: ReturnType<typeof extractPushBenefits> | null = null
  let firstError: string | null = null
  try {
    html = await fetcher.get(url)
    extracted = extractPushBenefits(html)
  } catch (error) {
    firstError = error instanceof Error ? error.message : String(error)
  }
  if (!extracted || extracted.calls === 0) {
    if (!fetcher.render) throw new DiscountSourceError(provider.id, `${BLOCKED_MESSAGE}${firstError ? ` (${firstError})` : ''}`, url)
    method = 'navegador (el pedido normal llegó sin los beneficios)'
    try {
      extracted = extractPushBenefits(await fetcher.render(url))
    } catch (error) {
      throw new DiscountSourceError(provider.id, `${BLOCKED_MESSAGE} (${error instanceof Error ? error.message : String(error)})`, url)
    }
    if (extracted.calls === 0) throw new DiscountSourceError(provider.id, BLOCKED_MESSAGE, url)
  }
  if (extracted.benefits.length === 0) throw new DiscountSourceError(provider.id, `Ningún pushBenefit se pudo leer: ${extracted.issues.slice(0, 3).join(' ')}`, url)
  onProgress?.({ phase: 'listing', done: 1, total: 1 })

  const today = montevideoToday(context.now?.() ?? new Date())
  const wanted = extracted.benefits.filter(isWanted)
  const warnings = [...extracted.issues]
  const notes = [`Leído con ${method}: ${extracted.benefits.length} beneficios en la página, ${wanted.length} restaurantes o cafeterías de Montevideo.`]
  const llm = { calls: 0, costUsd: 0 }
  const counts = { rules: 0, model: 0 }
  const hidden: string[] = []
  const places = new Map<string, ReadPlace>()

  for (const [index, benefit] of wanted.entries()) {
    onProgress?.({ phase: 'details', done: index, total: wanted.length })
    const name = cleanText(benefit.titulo)
    const state = vigency(benefit, today)
    if (state !== 'current') {
      hidden.push(`${name} (${state === 'expired' ? `vencido ${benefit.hasta}` : `empieza ${benefit.desde}`})`)
      continue
    }
    for (const field of ['desde', 'hasta'] as const) {
      if (benefit[field] && !dateOrNull(benefit[field])) warnings.push(`${name}: «${field}» no es una fecha (${benefit[field]}).`)
    }
    // Como la página: una promo vigente reemplaza los descuentos y el legal.
    const promo = benefit.promo && vigency(benefit.promo, today) === 'current' ? benefit.promo : null
    const items = (promo ? promo.descuentos ?? [] : benefit.descuentos ?? []).filter((item) => cleanText(item.pct ?? '') || cleanText(item.texto ?? ''))
    const rawLegal = promo ? promo.legal || benefit.legal || '' : benefit.legal || ''
    const terms = termsOf(rawLegal)
    const validFrom = dateOrNull(promo ? promo.desde : benefit.desde)
    const validTo = dateOrNull(promo ? promo.hasta : benefit.hasta)

    const lines: Line[] = []
    const extra: string[] = []
    const locations: ProviderPlaceLocation[] = []
    for (const item of items) {
      for (const part of boldParts(item.texto ?? '')) locations.push(locationOf(part))
      if (percentsIn(item.pct ?? '').length || percentsIn(item.texto ?? '').length) lines.push({ pct: item.pct ?? '', texto: item.texto ?? '', source: lineText(item) })
      else extra.push(lineText(item))
    }
    // Sin ninguna línea con porcentaje: la frase de porcentajes de las bases ("Todos los días 25% … y 15% …").
    if (lines.length === 0 && terms.text) {
      const sentence = terms.text.split(/(?<=\.)\s+|\n/).find((item) => percentsIn(item).length > 0)
      if (sentence) for (const clause of percentClauses(sentence)) lines.push({ ...clause, source: cleanText(`${clause.pct} ${clause.texto}`) })
      if (sentence) notes.push(`${name}: sin porcentaje en la card, leído de las bases.`)
    }

    const id = uniqueId(places, `${provider.id}:${slug(name)}`, warnings, name)
    const days = daysOf(benefit.dias)
    const benefits: DiscountBenefit[] = []
    for (const line of lines) {
      const read = await lineCards(line, terms.text, context, llm, warnings, name)
      if (!read) continue
      if (read.model) counts.model += read.cards.length
      else counts.rules += read.cards.length
      for (const { percent, card } of read.cards.map((card) => ({ percent: card.percent, card }))) {
        const cap: BenefitCap | null = card.cardTiers.length && !card.cardTiers.includes('Clásica') ? terms.caps.premium : terms.caps.rest
        benefits.push({
          id: benefitId(id, card.cardType, card.cardTiers),
          percent,
          cardType: card.cardType,
          cardTiers: card.cardTiers,
          cardProgram: null,
          days: days.days,
          daysText: days.daysText,
          mode: terms.mode,
          instantPercent: terms.mode === 'instant' ? percent : null,
          refundPercent: terms.mode === 'refund' ? percent : null,
          cap,
          validFrom,
          validTo,
          conditions: terms.text,
          sourceText: terms.text ? `${line.source}\n\n${terms.text}` : line.source,
          sourceUrl: url,
          parsedBy: read.model ? 'llm' : 'html',
        })
      }
    }
    // Una línea que no se leyó ya dejó su aviso; esto es para la card sin ninguna línea de descuento.
    if (benefits.length === 0 && lines.length === 0) warnings.push(`${name}: sin ninguna línea de descuento con porcentaje (ni en las bases).`)

    const sourceDepartments = parts(benefit.departamento)
    places.set(id, {
      id,
      providerId: provider.id,
      sourceName: name,
      category: parts(benefit.categoria).join(', ') || null,
      city: null,
      departments: departmentsIn([...sourceDepartments.map((part) => CITY_DEPARTMENT[part] ?? part)], []),
      montevideo: true,
      // Sin direcciones; si el texto nombra sucursales (shoppings, mercados), un local por cada una, sin dirección.
      locations,
      website: benefit.link && /^https?:\/\//.test(benefit.link.trim()) ? benefit.link.trim() : null,
      instagram: null,
      sourceUrl: url,
      logoUrl: benefit.logo?.trim() || null,
      description: extra.length ? extra.join(' ') : null,
      sourceTags: promo ? [cleanText(promo.etiqueta || 'PROMO')] : [],
      campaign: { validFrom, validTo, text: promo?.titulo ? cleanText(promo.titulo) : null },
      benefits: dedupeBenefitIds(benefits),
    })
  }
  onProgress?.({ phase: 'details', done: wanted.length, total: wanted.length })
  if (places.size === 0) throw new DiscountSourceError(provider.id, 'La página no trajo ningún restaurante o cafetería vigente de Montevideo.', url)
  notes.unshift(`Beneficios: ${counts.rules} por reglas, ${counts.model} por el modelo.`)
  if (hidden.length) notes.push(`No vigentes en la página (no se leen, como en el sitio): ${hidden.length} — ${hidden.join(', ')}.`)
  return { places: [...places.values()], unread: [], errors: [], warnings, notes, llm }
}

function uniqueId(places: Map<string, ReadPlace>, base: string, warnings: string[], name: string) {
  if (!places.has(base)) return base
  let count = 2
  while (places.has(`${base}-${count}`)) count += 1
  warnings.push(`${name}: el nombre se repite en la página; queda como ${base}-${count}.`)
  return `${base}-${count}`
}

type CardsRead = { cards: (ScotiaCard & { percent: number })[]; model: boolean }

/**
 * Las tarjetas de una línea: con reglas; si no se leen con confianza, con el modelo (validado: cada porcentaje y cada
 * nivel tienen que estar en el texto, débito sólo si la línea lo dice, y en una línea con dos porcentajes cada uno con
 * niveles propios que la línea nombra). Si sigue ambiguo, ningún beneficio y un aviso con el texto original.
 */
async function lineCards(line: Line, legal: string | null, context: ReaderContext, llm: { calls: number; costUsd: number }, warnings: string[], name: string): Promise<CardsRead | null> {
  const rules = parseScotiaLine(line.pct, line.texto)
  if (rules) return { cards: rules.cards.map((card) => ({ ...card, percent: rules.percent })), model: false }
  if (!context.structure) {
    warnings.push(`${name}: sin modelo configurado, no se leyó «${line.source}».`)
    return null
  }
  // El modelo ve la línea y la frase de porcentajes de las bases (que suele nombrar los niveles).
  const legalSentence = legal?.split(/(?<=\.)\s+|\n/).find((item) => percentsIn(item).length > 0) ?? null
  const text = legalSentence ? `${line.source}\nBases: ${legalSentence}` : line.source
  const result = await context.structure(text)
  if (!result.cached) {
    llm.calls += 1
    llm.costUsd += result.costUsd
  }
  const linePercents = new Set(percentsIn(line.source))
  const folded = fold(text)
  // Los de otro porcentaje vienen de la frase de las bases (otra línea los lee): se dejan sin aviso.
  const ofLine = result.benefits.filter((benefit) => linePercents.has(benefit.percent))
  const valid = ofLine.filter((benefit) => (benefit.cardType !== 'debit' || mentionsDebit(line.source)) && benefit.cardTiers.every((tier) => folded.includes(fold(tier))))
  if (valid.length !== ofLine.length) warnings.push(`${name}: el modelo propuso algo que «${line.source}» no dice (porcentaje, nivel o débito): descartado.`)
  const percents = new Set(valid.map((benefit) => benefit.percent))
  // Dos porcentajes en una línea: sólo si cada uno quedó con niveles propios (si no, el reparto es un invento).
  const reliable = linePercents.size <= 1 || (percents.size === linePercents.size && valid.every((benefit) => benefit.cardTiers.length > 0)
    && new Set(valid.map((benefit) => `${benefit.cardType}:${[...benefit.cardTiers].sort().join(',')}`)).size === valid.length)
  if (valid.length === 0 || !reliable) {
    warnings.push(`${name}: no se pudo asignar cada porcentaje a sus tarjetas, queda sin beneficio: «${line.source}».`)
    return null
  }
  return { cards: valid.map((benefit) => ({ cardType: benefit.cardType, cardTiers: benefit.cardTiers, percent: benefit.percent })), model: true }
}
