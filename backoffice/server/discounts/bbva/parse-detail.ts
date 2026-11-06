import { load, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { BenefitMode, CardType, ProviderPlaceLocation } from '../../../src/types/discounts.ts'
import { DiscountSourceError } from '../errors.ts'
import { DEPARTMENTS } from '../geo.ts'
import { cleanText, fold, spanishDates, validityRange } from '../text.ts'

/** Una línea de "Descuentos:" ya leída. */
export type BbvaBenefitLine = {
  text: string
  percent: number
  cardType: CardType
  cardTiers: string[]
  /** Tarjeta co-branded a la que se limita ("Nacional"). */
  cardProgram: string | null
}

/** Un bloque de los legales para un tipo de tarjeta (y, en crédito, unos niveles). */
export type BbvaLegalClause = {
  cardType: CardType
  cardTiers: string[]
  /** Texto del párrafo, original. */
  text: string
  percent: number | null
  instantPercent: number | null
  refundPercent: number | null
  cap: string | null
}

export type BbvaDetail = {
  name: string
  subtitle: string | null
  /** "Vigencia: 31 de Octubre 2027". */
  validityText: string | null
  lines: BbvaBenefitLine[]
  /** Líneas de "Descuentos:" que no se pudieron leer con la regla (van al modelo). */
  unparsedLines: string[]
  locations: ProviderPlaceLocation[]
  website: string | null
  instagram: string | null
  /** Párrafos sueltos del detalle: alcance ("El beneficio aplica a…"). */
  scope: string[]
  /** Secciones del detalle que no conozco ("Horario:", …), para el reporte. */
  unknownSections: string[]
  legal: {
    campaignText: string | null
    validFrom: string | null
    validTo: string | null
    clauses: BbvaLegalClause[]
    /** Exclusiones y demás párrafos de los legales que no son de un tipo de tarjeta. */
    conditions: string[]
  } | null
  logoUrl: string | null
}

// ── Tarjetas y niveles ──

/** "Internacionales" → "Internacional"; mayúscula inicial. */
export function normalizeTier(raw: string): string {
  const value = cleanText(raw).replace(/[.:]+$/, '')
  const folded = fold(value)
  const singular: Record<string, string> = { internacionales: 'Internacional', corporativas: 'Corporativa', corporativa: 'Corporativa', pymes: 'Pymes', 'pyme': 'Pymes' }
  if (singular[folded]) return singular[folded]
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** "Internacional, Oro, Pymes y Corporativas" → ['Internacional','Oro','Pymes','Corporativa']. */
export function splitTiers(raw: string): string[] {
  const text = cleanText(raw).replace(/^(?:tarjetas?\s+de\s+cr[eé]dito|tarjetas?)\s*/i, '')
  if (!text) return []
  return text
    .split(/\s*,\s*|\s+y\s+|\s+e\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeTier)
}

function cardTypeOf(word: string): CardType {
  const folded = fold(word)
  if (folded.startsWith('debito')) return 'debit'
  if (folded.startsWith('credito')) return 'credit'
  return 'other'
}

// Tarjetas co-branded de BBVA que aparecen en las etiquetas del listado y en algunos detalles.
const CARD_PROGRAMS: { pattern: RegExp; name: string }[] = [
  { pattern: /\b(?:bbva\s+)?club\s+nacional\s+de\s+football\b|\b(?:bbva\s+)?nacional\b/i, name: 'Nacional' },
  { pattern: /\b(?:bbva\s+)?(?:club\s+atl[eé]tico\s+)?pe[ñn]arol\b/i, name: 'Peñarol' },
  { pattern: /\bsodimac\b/i, name: 'Sodimac' },
  { pattern: /\babtour(?:\s+viajes)?\b/i, name: 'Abtour' },
  { pattern: /\bconsolid(?:\s+travel)?\b/i, name: 'Consolid' },
]

/** Saca la tarjeta co-branded del texto de niveles: "Oro BBVA Club Nacional de Football" → "Oro" + "Nacional". */
export function extractCardProgram(text: string): { rest: string; cardProgram: string | null } {
  for (const program of CARD_PROGRAMS) {
    if (program.pattern.test(text)) return { rest: cleanText(text.replace(program.pattern, ' ')), cardProgram: program.name }
  }
  return { rest: text, cardProgram: null }
}

const LINE = /^(\d{1,3})\s*%\s*(?:off|de descuento|dto\.?)?\s*con\s+tarjetas?\s+(?:de\s+)?(d[eé]bito|cr[eé]dito)\b\s*(.*)$/i

/** "30% Off con Tarjetas de Crédito Platinum, Black e Infinite". null si no tiene esa forma. */
export function parseBenefitLine(text: string): BbvaBenefitLine | null {
  const line = cleanText(text)
  const match = LINE.exec(line)
  if (!match) return null
  const percent = Number(match[1])
  if (!(percent > 0 && percent <= 100)) return null
  const { rest, cardProgram } = extractCardProgram(match[3])
  return { text: line, percent, cardType: cardTypeOf(match[2]), cardTiers: splitTiers(rest), cardProgram }
}

// ── Legales ──

const pct = (text: string, pattern: RegExp) => {
  const match = pattern.exec(text)
  return match ? Number(match[1].replace(',', '.')) : null
}

/** El párrafo de un tipo de tarjeta: total, parte en el punto de venta, parte en el estado de cuenta y tope. */
export function parseLegalClause(text: string, cardType: CardType, cardTiers: string[]): BbvaLegalClause {
  const folded = fold(text)
  const percent = pct(folded, /descuento (?:sera|es) de(?: un)? (\d+(?:[.,]\d+)?)\s*%/)
  let instantPercent = pct(folded, /(\d+(?:[.,]\d+)?)\s*% en (?:el )?punto de venta/)
  let refundPercent = pct(folded, /(\d+(?:[.,]\d+)?)\s*% restante/) ?? pct(folded, /(\d+(?:[.,]\d+)?)\s*% (?:se (?:vera|acreditara|reintegrara)|en (?:el )?estado de cuenta)/)
  const refundSentence = folded.split(/(?<=\.)\s+/).find((sentence) => /restante|estado de cuenta|reintegro/.test(sentence) && /tope/.test(sentence)) ?? null
  if (instantPercent === null && refundPercent === null && percent !== null) {
    // "se aplicará en el punto de venta" sin porcentaje: todo en el momento. El "sin tope de devolución" de esa
    // frase no lo hace reintegro.
    if (/se aplicara (?:en el |en |al )?punto de venta|en el momento|en caja/.test(folded) && !/restante|reflejad[oa] en el estado de cuenta/.test(folded)) instantPercent = percent
    else if (/estado de cuenta|reintegro/.test(folded)) refundPercent = percent
  }
  if (instantPercent !== null && refundPercent === null && percent !== null && instantPercent < percent && /restante|estado de cuenta/.test(folded)) refundPercent = percent - instantPercent
  // El tope es el de la devolución: "el tope de devolución será de 4000 pesos…", o "sin tope" en la frase del reintegro
  // (el "sin tope" de la parte en el punto de venta no cuenta si hay reintegro).
  const capMatch = /tope de devoluci[oó]n (?:ser[aá] de|de|es de)\s+(.+?)(?:\.(?:\s|$|(?=[A-ZÁÉÍÓÚ]))|,\s*en el cu[aá]l|\s+El descuento|$)/i.exec(cleanText(text))
  let cap: string | null = capMatch ? cleanText(capMatch[1]) : null
  if (!cap && /sin tope/.test(refundPercent ? refundSentence ?? '' : folded)) cap = 'Sin tope'
  return { cardType, cardTiers, text: cleanText(text), percent, instantPercent, refundPercent, cap }
}

export function modeOf(clause: Pick<BbvaLegalClause, 'percent' | 'instantPercent' | 'refundPercent'> | null): BenefitMode {
  if (!clause) return 'unknown'
  const { instantPercent, refundPercent } = clause
  if (instantPercent && refundPercent) return 'mixed'
  if (instantPercent) return 'instant'
  if (refundPercent) return 'refund'
  return 'unknown'
}

function parseLegal($: CheerioAPI): BbvaDetail['legal'] {
  const block = $('.textandimage__base').filter((_, element) => /t[eé]rminos y condiciones/i.test($(element).find('h3').first().text())).first()
  const body = block.find('.textandimage__text').first()
  if (body.length === 0) return null
  let campaignText: string | null = null
  let range: { validFrom: string | null; validTo: string | null } | null = null
  const clauses: BbvaLegalClause[] = []
  const conditions: string[] = []
  let cardType: CardType | null = null
  let tiers: string[] = []
  body.children('p, ul, div').each((_, element) => {
    const node = $(element)
    const text = cleanText(node.text())
    if (!text) return
    const folded = fold(text)
    const bold = cleanText(node.find('b, strong').text())
    // Encabezado: TARJETAS DE DÉBITO / TARJETAS DE CRÉDITO (todo en negrita).
    const header = /^tarjetas? de (debito|credito)$/.exec(folded)
    if (header && bold.length >= text.length - 1) {
      cardType = cardTypeOf(header[1])
      tiers = []
      return
    }
    // Subtítulo de niveles: "Tarjetas de crédito Internacionales, Oro, Pymes y Corporativas".
    if (bold && bold.length >= text.length - 1 && /^tarjetas? de (debito|credito)\s+\S/.test(folded)) {
      cardType = cardTypeOf(/^tarjetas? de (debito|credito)/.exec(folded)![1])
      tiers = splitTiers(text.replace(/^tarjetas?\s+de\s+(?:d[eé]bito|cr[eé]dito)\s*/i, ''))
      return
    }
    if (!range && /promocion valida|vigencia|valida (?:del|desde)/.test(folded)) {
      range = validityRange(text)
      if (range) {
        campaignText = text
        return
      }
    }
    if (cardType && /descuento (?:sera|es) de/.test(folded)) {
      clauses.push(parseLegalClause(text, cardType, tiers))
      return
    }
    conditions.push(text)
  })
  const found = range as { validFrom: string | null; validTo: string | null } | null
  return { campaignText, validFrom: found?.validFrom ?? null, validTo: found?.validTo ?? null, clauses, conditions }
}

// ── Detalle ──

// "Locales en Montevideo:", "Local:", "Dirección:"…
const SECTION_WORDS = 'vigencia|descuentos?|local(?:es)?|sucursal(?:es)?|direcci[oó]n(?:es)?|web|sitio web|p[aá]gina web|redes sociales|redes|instagram|facebook|horarios?|d[ií]as|tel[eé]fonos?|whatsapp'
const SECTION = new RegExp(`^(${SECTION_WORDS})(?:\\s+(?:en|de)\\s+([^:]{1,40}))?\\s*:`, 'i')
// Un título sin dos puntos, todo en negrita ("Local").
const BARE_SECTION = new RegExp(`^(${SECTION_WORDS})(?:\\s+(?:en|de)\\s+([^:]{1,40}))?$`, 'i')

/** "Locales en Canelones" → Canelones; null si no es un departamento. */
function departmentOf(text: string | undefined): string | null {
  if (!text) return null
  return DEPARTMENTS.find((name) => fold(name) === fold(text)) ?? null
}

function sectionOf(text: string, bold: boolean): { label: string; department: string | null; rest: string } | null {
  const clean = cleanText(text)
  const match = SECTION.exec(clean) ?? (bold ? BARE_SECTION.exec(clean) : null)
  if (!match) return null
  const label = sectionLabel(fold(match[1]))
  return { label, department: label === 'locales' ? departmentOf(match[2]) : null, rest: cleanText(clean.slice(match[0].length)) }
}

function sectionLabel(key: string): string {
  if (key.startsWith('descuento')) return 'descuentos'
  if (key.startsWith('local') || key.startsWith('direccion') || key.startsWith('sucursal')) return 'locales'
  if (key === 'web' || key === 'sitio web' || key.endsWith('gina web')) return 'web'
  if (key.startsWith('redes') || key === 'instagram' || key === 'facebook') return 'redes'
  // Teléfonos: no se guardan (vienen de otras fuentes en la página del local).
  if (key.startsWith('telefono') || key === 'whatsapp') return 'telefono'
  return key
}

const isBold = (node: ReturnType<CheerioAPI>) => {
  const text = cleanText(node.text())
  const bold = cleanText(node.find('b, strong').text())
  return text.length > 0 && bold.length >= text.length - 1
}

/** Handle de Instagram de un link o de un "@handle". */
export function instagramHandle(value: string | undefined | null): string | null {
  if (!value) return null
  const fromUrl = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(value)
  const handle = fromUrl?.[1] ?? /@([A-Za-z0-9._]{1,30})/.exec(value)?.[1]
  if (!handle || ['p', 'reel', 'stories', 'explore'].includes(handle.toLowerCase())) return null
  return handle.toLowerCase().replace(/\.+$/, '')
}

/** "José Ellauri 842, Pocitos (ir)" → dirección, barrio después de la última coma y el link a Maps. */
export function parseLocation($: CheerioAPI, item: AnyNode, department: string | null = null): ProviderPlaceLocation | null {
  const node = $(item)
  const href = node.find('a[href*="maps"], a[href*="goo.gl"]').first().attr('href')
  // Algunos links son texto ("ir%20a%20Google%20Maps"), no una URL.
  const mapsUrl = href && /^https?:\/\//.test(href) ? href : null
  const text = cleanText(node.text()).replace(/\(\s*ir\s*\)/gi, '').replace(/\s+,/g, ',').trim().replace(/^[–—-]\s*/, '').replace(/[,.\s]+$/, '')
  if (!text) return null
  return { address: text, ...areaOf(text, department), mapsUrl }
}

/**
 * Barrio o localidad: lo de después de la última coma, si no tiene números (no es "esq. 21 de Setiembre, 2890"). Si
 * es un departamento ("Chucarro 1210, Pocitos, Montevideo"), va a department y el barrio es lo anterior.
 */
export function areaOf(address: string, department: string | null): { area: string | null; department: string | null } {
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return { area: null, department }
  let last = parts.at(-1)!
  const named = departmentOf(last)
  if (named && parts.length >= 3) {
    department ??= named
    last = parts.at(-2)!
  } else if (named) {
    return { area: last, department: department ?? named }
  }
  return { area: /\d/.test(last) ? null : last, department }
}

/** Acordeón "Locales Adheridos" (Grido): un panel por departamento con una tabla dirección | barrio. */
function accordionLocations($: CheerioAPI): ProviderPlaceLocation[] {
  const locations: ProviderPlaceLocation[] = []
  $('[id^="content-accordion"] .accordion__list__item__heading').each((_, heading) => {
    const label = cleanText($(heading).attr('data-accordion-label') ?? $(heading).text())
    const department = DEPARTMENTS.find((name) => fold(name) === fold(label)) ?? null
    const panel = $(heading).closest('h1, h2, h3, div').nextAll('.accordion__list').first()
    const rows = panel.find('tr').toArray().map((row) => $(row).find('td, th').toArray().map((cell) => cleanText($(cell).text())))
    // Las columnas cambian de orden según la página ("Barrio | Dirección" o dirección y barrio sin encabezado).
    const header = rows[0]?.map(fold) ?? []
    const hasHeader = header.some((cell) => /^(barrio|direccion|localidad|zona|ciudad)$/.test(cell))
    const body = hasHeader ? rows.slice(1) : rows
    let addressColumn = header.findIndex((cell) => cell === 'direccion')
    if (addressColumn < 0) {
      // Sin encabezado: la dirección es la columna con más números.
      const digits = (column: number) => body.filter((cells) => /\d/.test(cells[column] ?? '')).length
      addressColumn = digits(1) > digits(0) ? 1 : 0
    }
    const areaColumn = addressColumn === 0 ? 1 : 0
    for (const cells of body) {
      const address = cells[addressColumn]
      if (!address) continue
      locations.push({ address, area: cells[areaColumn] || null, department, mapsUrl: null })
    }
  })
  return locations
}

/** El detalle de un lugar. Falla si no tiene el bloque de texto o la lista de descuentos. */
export function parseBbvaDetail(html: string, url: string): BbvaDetail {
  const $ = load(html)
  const name = cleanText($('h1.h1title__title').first().text() || $('h1').first().text())
  const text = $('.promodetail__text').first()
  if (!name || text.length === 0) {
    throw new DiscountSourceError('bbva', `El detalle no tiene título o bloque de beneficios (.promodetail__text): cambió la estructura.`, url)
  }
  let section: string | null = null
  let sectionDepartment: string | null = null
  let validityText: string | null = null
  const lines: BbvaBenefitLine[] = []
  const unparsedLines: string[] = []
  const locations: ProviderPlaceLocation[] = []
  let website: string | null = null
  let instagram: string | null = null
  const scope: string[] = []
  const unknownSections: string[] = []
  let sawDiscounts = false

  text.children().each((_, element) => {
    const node = $(element)
    const content = cleanText(node.text())
    if (!content) return
    const tag = element.type === 'tag' ? element.tagName.toLowerCase() : ''
    if (tag !== 'ul' && tag !== 'ol') {
      const heading = sectionOf(content, isBold(node))
      if (heading) {
        const label = heading.label
        section = label
        sectionDepartment = heading.department
        const rest = heading.rest
        if (label === 'vigencia') validityText = content
        else if (label === 'descuentos') sawDiscounts = true
        else if (label === 'web') website = node.find('a[href]').first().attr('href') ?? (rest || null)
        else if (label === 'redes') instagram ??= instagramHandle(node.find('a[href*="instagram"]').first().attr('href')) ?? (/instagram/i.test(content) ? instagramHandle(rest) : null)
        else if (label === 'locales' && rest) {
          const location = parseLocation($, element, sectionDepartment)
          if (location) locations.push({ ...location, address: cleanText(location.address.replace(SECTION, '')) || location.address })
        } else if (label !== 'locales' && label !== 'telefono') unknownSections.push(content)
        return
      }
      // Una dirección en un párrafo, después de "Local:" (con el "(ir)" o el link a Maps).
      if (section === 'locales' && (/\(\s*ir\s*\)/i.test(content) || node.find('a[href*="maps"], a[href*="goo.gl"]').length)) {
        const location = parseLocation($, element, sectionDepartment)
        if (location) locations.push(location)
        return
      }
      // Un párrafo suelto cierra la sección: es alcance o descripción.
      section = null
      scope.push(content)
      return
    }
    const items = node.children('li').toArray()
    if (section === 'descuentos') {
      for (const item of items) {
        const line = parseBenefitLine($(item).text())
        if (line) lines.push(line)
        else if (cleanText($(item).text())) unparsedLines.push(cleanText($(item).text()))
      }
    } else if (section === 'locales') {
      for (const item of items) {
        const location = parseLocation($, item, sectionDepartment)
        if (location) locations.push(location)
      }
    } else if (section === 'redes') {
      for (const item of items) {
        const node = $(item)
        if (/instagram/i.test(node.text()) || node.find('a[href*="instagram"]').length) {
          instagram ??= instagramHandle(node.find('a[href*="instagram"]').first().attr('href')) ?? instagramHandle(node.text())
        }
      }
    } else {
      // Una lista fuera de las secciones conocidas: queda en el reporte.
      unknownSections.push(content)
    }
  })

  if (!sawDiscounts || (lines.length === 0 && unparsedLines.length === 0)) {
    throw new DiscountSourceError('bbva', `El detalle de «${name}» no tiene la lista "Descuentos:": cambió la estructura.`, url)
  }
  const logo = $('.promodetail__image img').first().attr('src')
  return {
    name,
    subtitle: cleanText($('.h1title__subtitle').first().text()) || null,
    validityText,
    lines,
    unparsedLines,
    locations: [...locations, ...accordionLocations($)],
    website,
    instagram,
    scope,
    unknownSections,
    legal: parseLegal($),
    logoUrl: logo ? new URL(logo, url).toString() : null,
  }
}

/** "Vigencia: 31 de Octubre 2027" → fecha de fin. */
export function validityEnd(text: string | null): string | null {
  return text ? spanishDates(text).at(-1) ?? null : null
}

