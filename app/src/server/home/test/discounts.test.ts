import { describe, expect, it, vi } from 'vitest'
import type { CandidateRow } from '../../search/candidates'
import type { PlaceDiscount } from '../../discounts/selection'
import { everyDay, fakeCache, fakeStore, row } from '../../search/test/fixtures'
import { assembleHome } from '../assemble'
import { DISCOUNT_ROW_PREFIX, homeDiscountRows } from '../discounts'

// Lunes 12/10/2026 13:00 en Montevideo.
const now = new Date('2026-10-12T16:00:00Z')

const place = (id: string, discounts: PlaceDiscount[], overrides: Partial<CandidateRow> = {}) =>
  row({ id, discounts, hours: everyDay('08:00', '23:59'), neighborhoodId: `N${id}`, prominence: 1, ...overrides })

const itauCredit: PlaceDiscount = { provider: 'itau', cardType: 'credit' }
const itauDebit: PlaceDiscount = { provider: 'itau', cardType: 'debit' }
const itauAny: PlaceDiscount = { provider: 'itau', cardType: 'other' }
const brouDebit: PlaceDiscount = { provider: 'brou', cardType: 'debit' }

const deps = (places: CandidateRow[]) => {
  const { store, calls } = fakeStore(places)
  return { deps: { store, cache: fakeCache().cache }, calls, store }
}

const ids = (rows: { places: { id: string }[] }[]) => rows.map((entry) => entry.places.map((item) => item.id).sort())

describe('"Descuentos con <Banco>" de la home', () => {
  it('sin tarjetas no hay filas ni búsquedas', async () => {
    const { deps: d, calls } = deps([place('a', [itauCredit])])
    expect(await homeDiscountRows(d, [], now)).toEqual([])
    expect(calls).toEqual([])
  })

  it('una fila por proveedor, en el orden de la config, con los tipos elegidos ("cualquier tarjeta" cuenta)', async () => {
    const places = [place('c', [itauCredit]), place('d', [itauDebit]), place('o', [itauAny]), place('b', [brouDebit])]
    const { deps: d, calls } = deps(places)
    const rows = await homeDiscountRows(d, ['itau.credit', 'brou.debit'], now)
    expect(rows.map((entry) => entry.id)).toEqual([`${DISCOUNT_ROW_PREFIX}brou`, `${DISCOUNT_ROW_PREFIX}itau`])
    expect(rows.map((entry) => entry.title)).toEqual(['Descuentos con BROU', 'Descuentos con Itaú'])
    // Itaú crédito: el de crédito y el de cualquier tarjeta, no el de débito.
    expect(ids(rows)).toEqual([['b'], ['c', 'o']])
    // Sin texto y siempre con "Abre hoy".
    expect(calls.every((call) => call.filters.openAt?.today)).toBe(true)
  })

  it('con débito y crédito del mismo banco, una sola fila con los dos', async () => {
    const { deps: d } = deps([place('c', [itauCredit]), place('d', [itauDebit])])
    const rows = await homeDiscountRows(d, ['itau.debit', 'itau.credit'], now)
    expect(rows).toHaveLength(1)
    expect(ids(rows)).toEqual([['c', 'd']])
    expect(rows[0].href).toBe(`/search?f=${encodeURIComponent('open:today,discount:itau.debit,discount:itau.credit')}`)
  })

  it('ignora claves fuera del catálogo', async () => {
    const { deps: d, calls } = deps([place('a', [itauCredit])])
    expect(await homeDiscountRows(d, ['banco.credit', 'itau.other'], now)).toEqual([])
    expect(calls).toEqual([])
  })

  it('si falla un proveedor, los demás salen igual', async () => {
    const { deps: d, store } = deps([place('c', [itauCredit]), place('b', [brouDebit])])
    const candidates = store.candidates.bind(store)
    vi.spyOn(store, 'candidates').mockImplementation(async (filters, scores) => {
      if (filters.discounts?.some((choice) => choice.provider === 'brou')) throw new Error('timeout')
      return candidates(filters, scores)
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const rows = await homeDiscountRows(d, ['itau.credit', 'brou.debit'], now)
    expect(rows.map((entry) => entry.id)).toEqual([`${DISCOUNT_ROW_PREFIX}itau`])
  })

  it('pasan por assembleHome: mínimo de 4, sin cadenas y sin repetir los de "Para vos"', async () => {
    const places = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => place(id, [itauCredit]))
    places.push(place('chain', [itauCredit], { brandCount: 5, brandKey: 'chain' }))
    const [itau] = await homeDiscountRows(deps(places).deps, ['itau.credit'], now)
    const forYou = { id: 'for_you', title: 'Para vos', places: itau.places.filter((item) => ['a', 'b'].includes(item.id)), href: null }
    // Con "Para vos" (2 lugares, no sale) la fila de Itaú queda con 4 + los 2: sale completa sin la cadena.
    expect(assembleHome([forYou, itau]).map((entry) => [entry.id, entry.places.length])).toEqual([[`${DISCOUNT_ROW_PREFIX}itau`, 6]])
    const bigForYou = { ...forYou, places: itau.places.filter((item) => ['a', 'b', 'c', 'd'].includes(item.id)) }
    // "Para vos" se lleva 4: a Itaú le quedan 2 y no sale.
    expect(assembleHome([bigForYou, itau]).map((entry) => entry.id)).toEqual(['for_you'])
  })
})
