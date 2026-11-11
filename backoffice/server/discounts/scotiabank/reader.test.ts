import { describe, expect, it } from 'vitest'
import { DiscountSourceError } from '../errors.ts'
import type { PageFetcher } from '../polite-fetch.ts'
import { fixture, NOW, PAGE, recordedStructurer, SCOTIABANK } from './fixtures.ts'
import { BLOCKED_MESSAGE, isWanted, readScotiabank } from './reader.ts'

const fetcherOf = (html: string, render?: () => Promise<string>): PageFetcher => ({ requests: 0, get: async () => html, ...(render ? { render } : {}) })
const read = (html = fixture('beneficios'), extra: Partial<Parameters<typeof readScotiabank>[0]> = {}) =>
  readScotiabank({ provider: SCOTIABANK, fetcher: fetcherOf(html), now: NOW, structure: recordedStructurer(), ...extra })
const page = (...objects: string[]) => `<script>${objects.map((object) => `pushBenefit(${object});`).join('\n')}</script>`
const shape = (benefits: { percent: number; cardType: string; cardTiers: string[]; parsedBy: string }[]) => benefits.map(({ percent, cardType, cardTiers, parsedBy }) => [percent, cardType, cardTiers, parsedBy])

describe('readScotiabank con el HTML real', () => {
  it('filtra, deja afuera lo no vigente (como la página) y lee casi todo con reglas', async () => {
    const result = await read()
    expect(result.places).toHaveLength(74)
    expect(result.places.every((place) => place.montevideo && place.departments.includes('Montevideo') && place.sourceUrl === PAGE)).toBe(true)
    expect(result.notes).toEqual(expect.arrayContaining([
      'Beneficios: 283 por reglas, 2 por el modelo.',
      'Leído con pedido normal: 419 beneficios en la página, 80 restaurantes o cafeterías de Montevideo.',
      expect.stringMatching(/^No vigentes en la página .*: 6 — Atenea Coffee \(vencido 2020-03-30\), Oviedo \(vencido 2026-07-10\)/),
    ]))
    expect(result.places.map((place) => place.sourceName)).not.toContain('Atenea Coffee')
    expect(result.llm.calls).toBe(2)
  })

  it('campos de un beneficio común (Pier 21): tarjetas, días, modalidad, tope de compra sólo como texto, vigencia tal cual', async () => {
    const pier = (await read()).places.find((place) => place.id === 'scotiabank:pier-21')!
    expect(pier).toMatchObject({ sourceName: 'Pier 21', category: 'restaurantes', locations: [], instagram: null, logoUrl: expect.stringMatching(/^https:\/\/cdn\.aglty\.io\//), campaign: { validFrom: '2025-10-02', validTo: '3026-10-31' } })
    expect(shape(pier.benefits)).toEqual([[25, 'credit', ['Platinum', 'Infinite', 'Gold'], 'html'], [25, 'debit', ['Premium'], 'html'], [15, 'credit', [], 'html'], [15, 'debit', [], 'html']])
    expect(pier.benefits[0]).toMatchObject({ days: 'all', daysText: 'Todos los días', mode: 'instant', instantPercent: 25, refundPercent: null, validFrom: '2025-10-02', validTo: '3026-10-31', cap: { amount: null, currency: null, period: null } })
    expect(pier.benefits[0].conditions).toMatch(/^Todos los días 25% de ahorro/)
    expect(new Set(pier.benefits.map((benefit) => benefit.id)).size).toBe(4)
  })

  it('casos raros: Carbonada (modelo), IBER (sin asignar, con sucursales), Koffee Skates (de las bases), La Pasiva, topes por nivel', async () => {
    const result = await read()
    const byId = (id: string) => result.places.find((place) => place.id === `scotiabank:${id}`)!
    expect(shape(byId('carbonada').benefits)).toEqual([[25, 'credit', ['Platinum', 'Infinite', 'Gold'], 'llm'], [25, 'debit', ['Premium'], 'llm'], [15, 'credit', ['Clásica'], 'html'], [15, 'debit', ['Clásica'], 'html']])
    const iber = byId('iber-restaurantes')
    expect(iber.benefits).toEqual([])
    expect(iber.locations).toEqual([
      { address: 'Punta Carretas Shopping', area: 'Punta Carretas', department: 'Montevideo', mapsUrl: null },
      { address: 'Mercado Agrícola', area: 'Villa Muñoz', department: 'Montevideo', mapsUrl: null },
      { address: 'Punta Shopping', area: null, department: 'Maldonado', mapsUrl: null },
    ])
    expect(result.warnings).toContain('IBER restaurantes: no se pudo asignar cada porcentaje a sus tarjetas, queda sin beneficio: «25% y 15% de ahorro con tarjetas de crédito y débito en sus restaurantes, Punta Carretas Shopping, Mercado Agrícola y Punta Shopping.».')
    const koffee = byId('koffee-skates')
    expect(koffee.description).toBe('En el mes de Abril el descuento aplica a toda la tienda.')
    expect(shape(koffee.benefits)).toEqual([[25, 'credit', ['Platinum', 'Infinite', 'Gold'], 'html'], [25, 'debit', ['Premium'], 'html'], [15, 'credit', [], 'html'], [15, 'debit', [], 'html']])
    const pasiva = byId('la-pasiva')
    expect(pasiva.departments).toEqual(['Maldonado', 'Montevideo'])
    expect(pasiva.benefits[0]).toMatchObject({ mode: 'instant', cap: { amount: 3000, currency: 'UYU' } })
    expect(byId('oso-pardo').benefits.map((benefit) => [benefit.mode, benefit.cap?.amount])).toEqual([['refund', 2500], ['refund', 2500], ['refund', 1500], ['refund', 1500]])
    // Sin débito en la card (aunque las bases lo digan): no se inventa.
    expect(shape(byId('oro-del-rhin').benefits).map(([percent, type]) => `${percent} ${type}`)).toEqual(['25 credit', '25 debit', '15 credit'])
  })

  it('sin modelo, lo ambiguo queda como aviso (y el resto se lee igual)', async () => {
    const result = await read(undefined, { structure: undefined })
    expect(result.warnings).toContain('Carbonada: sin modelo configurado, no se leyó «25% de ahorro con tarjetas de crédito y débito Premium.».')
    expect(result.places).toHaveLength(74)
  })
})

describe('readScotiabank: filtros, promo y fechas', () => {
  const base = { titulo: 'Bar X', categoria: 'restaurantes', departamento: 'Montevideo', dias: 'custom:Jueves y Domingos', desde: '2026-01-01', hasta: '2030-01-01', logo: 'https://cdn.test/x.jpg', descuentos: [{ pct: '20% de ahorro', texto: 'con tarjetas de crédito.' }, { pct: '', texto: '' }], legal: 'El descuento se realiza en el estado de cuenta.' }
  const benefit = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...base, ...patch })

  it('categoría y departamento', () => {
    expect(isWanted({ titulo: 'a', categoria: 'restaurantes, librerias', departamento: 'maldonado, montevideo' })).toBe(true)
    expect(isWanted({ titulo: 'a', categoria: 'cafeteria', departamento: 'Montevideo,Maldonado' })).toBe(true)
    expect(isWanted({ titulo: 'a', categoria: 'platinumcard,restaurantes', departamento: 'montevideo' })).toBe(false)
    expect(isWanted({ titulo: 'a', categoria: 'restaurantes', departamento: 'nacional' })).toBe(false)
    expect(isWanted({ titulo: 'a', categoria: 'restaurantes', departamento: null })).toBe(false)
    expect(isWanted({ titulo: 'a', categoria: 'restaurantes' })).toBe(false)
    expect(isWanted({ titulo: 'a', categoria: 'vestimenta', departamento: 'montevideo' })).toBe(false)
  })

  it('días concretos, modalidad de reintegro, ítems vacíos ignorados', async () => {
    const [place] = (await read(page(benefit()))).places
    expect(place.benefits).toHaveLength(1)
    expect(place.benefits[0]).toMatchObject({ percent: 20, cardType: 'credit', days: ['thu', 'sun'], daysText: 'Jueves y Domingos', mode: 'refund', refundPercent: 20, instantPercent: null })
  })

  it('una promo vigente reemplaza los descuentos y el legal; vencida, no', async () => {
    const promo = { desde: '2026-11-01', hasta: '2026-11-30', titulo: 'Todo noviembre', etiqueta: 'PROMO ESPECIAL', descuentos: [{ pct: '30% de ahorro', texto: 'con Tarjetas de Crédito Scotiabank' }], legal: 'Promoción válida en noviembre. El descuento se realiza al momento de la compra.' }
    const [active] = (await read(page(benefit({ promo })))).places
    expect(active.benefits.map((item) => [item.percent, item.mode, item.validFrom, item.validTo])).toEqual([[30, 'instant', '2026-11-01', '2026-11-30']])
    expect(active.sourceTags).toEqual(['PROMO ESPECIAL'])
    const [past] = (await read(page(benefit({ promo: { ...promo, desde: '2026-09-01', hasta: '2026-09-30' } })))).places
    expect(past.benefits.map((item) => item.percent)).toEqual([20])
  })

  it('no vigente (vencido o todavía no empieza): no se lee; ninguno vigente es un error, no una lista vacía', async () => {
    const result = await read(page(benefit({ titulo: 'Futuro', desde: '2027-01-01' }), benefit({ titulo: 'Vigente' })))
    expect(result.places.map((place) => place.sourceName)).toEqual(['Vigente'])
    expect(result.notes?.at(-1)).toBe('No vigentes en la página (no se leen, como en el sitio): 1 — Futuro (empieza 2027-01-01).')
    await expect(read(page(benefit({ hasta: '2026-11-10' })))).rejects.toBeInstanceOf(DiscountSourceError)
  })

  it('el mismo nombre dos veces: otro id y un aviso', async () => {
    const result = await read(page(benefit(), benefit()))
    expect(result.places.map((place) => place.id)).toEqual(['scotiabank:bar-x', 'scotiabank:bar-x-2'])
    expect(result.warnings).toContain('Bar X: el nombre se repite en la página; queda como scotiabank:bar-x-2.')
  })
})

describe('readScotiabank: Akamai', () => {
  const blocked = '<html><head><title>Access Denied</title></head><body>Reference #18.abc</body></html>'

  it('sin pushBenefit en el pedido normal, lee la página renderizada en el navegador', async () => {
    let rendered = 0
    const result = await readScotiabank({ provider: SCOTIABANK, now: NOW, structure: recordedStructurer(), fetcher: fetcherOf(blocked, async () => { rendered += 1; return fixture('beneficios-rendered') }) })
    expect(rendered).toBe(1)
    expect(result.places).toHaveLength(74)
    expect(result.notes).toContain('Leído con navegador (el pedido normal llegó sin los beneficios): 419 beneficios en la página, 80 restaurantes o cafeterías de Montevideo.')
  })

  it('si tampoco vienen en el navegador (o no hay navegador, o el pedido falla), un error claro', async () => {
    await expect(readScotiabank({ provider: SCOTIABANK, now: NOW, fetcher: fetcherOf(blocked, async () => blocked) })).rejects.toThrow(BLOCKED_MESSAGE)
    await expect(readScotiabank({ provider: SCOTIABANK, now: NOW, fetcher: fetcherOf(blocked) })).rejects.toThrow(/^Scotiabank bloqueó la lectura/)
    const failing: PageFetcher = { requests: 0, get: async () => { throw new Error('respondió 403.') }, render: async () => { throw new Error('timeout') } }
    await expect(readScotiabank({ provider: SCOTIABANK, now: NOW, fetcher: failing })).rejects.toThrow(/^Scotiabank bloqueó la lectura.*timeout/)
  })
})
