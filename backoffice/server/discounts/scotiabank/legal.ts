import * as cheerio from 'cheerio'
import type { BenefitCap, BenefitMode } from '../../../src/types/discounts.ts'
import { cleanText, fold, parseCap } from '../text.ts'

/**
 * El legal tal como lo da la fuente. En el HTML inicial viene en texto (HTML); en el DOM ya renderizado (`data-legal`)
 * viene en base64 de UTF-8. Si parece base64 y se decodifica a UTF-8 válido, se decodifica; si no, se usa tal cual.
 */
export function decodeLegal(raw: string): string {
  const value = raw.trim()
  if (value.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return raw
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64'))
  } catch {
    return raw
  }
}

/** HTML del legal a texto, con un renglón por <br> o párrafo. */
export function legalToText(html: string): string {
  const $ = cheerio.load(`<div id="legal">${html.replace(/<\/?br\s*\/?>/gi, '\n')}</div>`)
  $('#legal p, #legal div, #legal li').each((_, element) => {
    $(element).append('\n')
  })
  return $('#legal').text().split('\n').map(cleanText).filter(Boolean).join('\n')
}

export type LegalSection = { title: string | null; text: string }

/**
 * Las bases partidas por sucursal cuando las encabeza un título en negrita ("<strong>La Pasiva Prado, Montevideo:</strong>").
 * Sin títulos, una sola sección.
 */
export function legalSections(html: string): LegalSection[] {
  const parts = html.split(/<(?:strong|b)>([^<]*?):?\s*<\/(?:strong|b)>/i)
  if (parts.length < 3) return [{ title: null, text: legalToText(html) }]
  const sections: LegalSection[] = []
  const before = legalToText(parts[0])
  if (before) sections.push({ title: null, text: before })
  for (let index = 1; index < parts.length; index += 2) sections.push({ title: cleanText(parts[index]).replace(/:$/, ''), text: legalToText(parts[index + 1] ?? '') })
  return sections
}

/** Las secciones que valen para Montevideo: las que lo nombran en el título; si ninguna lo nombra, todas. */
export function montevideoSections(sections: LegalSection[]): LegalSection[] {
  const titled = sections.filter((section) => section.title)
  if (titled.length < 2) return sections
  const mvd = titled.filter((section) => /montevideo/.test(fold(section.title!)))
  return mvd.length ? mvd : sections
}

/**
 * Modalidad de las bases: "se realiza en el momento / al momento de la compra" (o "en el restaurante/establecimiento") es
 * en el momento; "en el estado de cuenta" es reintegro. Las dos a la vez, o ninguna: unknown.
 */
export function modeOf(text: string): BenefitMode {
  const folded = fold(text)
  const instant = /\b(?:en|al) (?:el )?momento\b|se realiza(?:ra)? en el (?:restaurante|establecimiento)|punto de venta/.test(folded)
  const refund = /estado de cuenta|reintegro/.test(folded)
  if (instant && refund) return 'unknown'
  return instant ? 'instant' : refund ? 'refund' : 'unknown'
}

/** Oraciones de un texto (sin cortar en "$10.000"). */
const sentences = (text: string) => text.split(/(?<=[.;])\s+|\n+/).map(cleanText).filter(Boolean)

/**
 * Un tope por grupo de tarjetas: `premium` para los beneficios con niveles (Platinum, Infinite, Gold, Débito Premium),
 * `rest` para los que no tienen (crédito y débito, clásicas). Casi siempre es uno solo para los dos.
 *
 * Sólo se lee el monto cuando dice que es del descuento ("tope de descuento", "de devolución", "de reintegro"). El tope de
 * compra o de factura ("Tope de compra $10.000": el máximo de la factura) y el que no dice de qué es ("Tope de $10.000 por
 * compra") quedan sólo con el texto.
 */
export function capsOf(text: string): { premium: BenefitCap | null; rest: BenefitCap | null } {
  const found = sentences(text).find((item) => /\btope\b/i.test(item))
  if (!found) return { premium: null, rest: null }
  // Desde la palabra "tope": a veces falta el punto antes ("… Débito Premium El descuento … Tope de descuento por compra
  // $ 1.500") y el monto se tomaría de un porcentaje anterior.
  const sentence = found.slice(found.search(/\btope\b/i))
  const folded = fold(sentence)
  const ofDiscount = /tope (?:maximo )?de (?:descuento|devolucion|reintegro)|de descuento por compra|\$\s?[\d.]+ de descuento/.test(folded)
  const textOnly = (value: string): BenefitCap => ({ text: value, amount: null, currency: null, period: null })
  const capOf = (value: string): BenefitCap => (ofDiscount ? parseCap(value) ?? textOnly(value) : textOnly(value))
  // "… para tarjetas Platinum, Infinite, Gold y Débito Premium $1.500 y para tarjetas de crédito y débito clásicas $1.000".
  const tiered = /^(.*?para (?:tarjetas )?.+?\$\s?[\d.]+)\s+y\s+(para (?:tarjetas )?.+?\$\s?[\d.]+.*)$/i.exec(sentence)
  if (tiered) {
    const lead = /^(.*?)para /i.exec(tiered[1])?.[1] ?? ''
    const premium = capOf(tiered[1])
    const rest = capOf(`${lead}${tiered[2]}`)
    if (!ofDiscount) return { premium: textOnly(sentence), rest: textOnly(sentence) }
    return { premium: { ...premium, text: sentence }, rest: { ...rest, text: sentence } }
  }
  const cap = capOf(sentence)
  return { premium: cap, rest: cap }
}
