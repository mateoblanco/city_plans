import { describe, expect, it, vi } from 'vitest'
import type { ExaPlaceResponse, ExaPlaceResult } from '../../src/types/places.ts'
import { computeProminence } from './prominence.ts'

// Lo que vale un lugar sin seguidores en estas pruebas (distinto de 0,5 para que se note).
const MEDIAN = 0.8
import { recomputeChains, refreshSignals, signalsFromSnapshots, type RefreshDeps, type SignalsRow } from './refresh-signals.ts'

const row = (overrides: Partial<SignalsRow> = {}): SignalsRow => ({
  id: 'uuid-1', googlePlaceId: 'g-1', name: 'El Palenque', instagram: 'elpalenque',
  igFollowers: null, chainBranch: false, prominence: computeProminence({ igFollowers: null }, MEDIAN), ...overrides,
})

const exa = (results: ExaPlaceResult[]): ExaPlaceResponse => ({
  source: 'exa', query: '', requestId: 'r', attribution: 'Exa', results,
  output: { content: { description: '', address: '', contact_info: '', open_hours_raw: '', open_hours: [], knows_before_you_go: '', menu: [] }, grounding: {} },
})

const press: ExaPlaceResult[] = [
  { title: 'Las mejores parrillas de Montevideo', url: 'https://www.elpais.com.uy/a', highlights: ['El Palenque, en el Mercado del Puerto.'] },
  { title: 'El Palenque', url: 'https://www.tripadvisor.com.uy/x', highlights: ['El Palenque'] },
]

function deps(overrides: Partial<RefreshDeps> = {}): RefreshDeps {
  return {
    searchPlace: vi.fn(async () => exa(press)),
    scrapeInstagram: vi.fn(async () => ({ url: 'https://www.instagram.com/elpalenque/', name: 'El Palenque', bio: '', links: [], followers: 999 })),
    write: vi.fn(async () => {}),
    igMedian: MEDIAN,
    ...overrides,
  }
}

describe('refreshSignals', () => {
  it('lee los seguidores con Apify y escribe sólo igFollowers y prominence', async () => {
    const d = deps()

    const [result] = await refreshSignals([row()], d)

    expect(d.searchPlace).toHaveBeenCalledWith('El Palenque')
    expect(d.scrapeInstagram).toHaveBeenCalledWith('https://www.instagram.com/elpalenque/')
    expect(result).toMatchObject({ status: 'changed', chain: false })
    expect(d.write).toHaveBeenCalledWith('uuid-1', { igFollowers: 999, chainBranch: false, prominence: expect.closeTo(0.6) })
  })

  it('un campo editado a mano no cambia: escribe sólo las columnas de señales', async () => {
    const d = deps()
    const edited = row({ manualOverrides: { instagram: 'elpalenque', name: 'Palenque', style: 'cuidado', brand_key: 'palenque' } })

    await refreshSignals([edited], d)
    await signalsFromSnapshots([edited], [{
      googlePlaceId: 'g-1', sources: [], prominenceSignals: { instagramFollowers: 500 } as never, instagramAudit: { saved: 'elpalenque' } as never,
    }], { igMedian: MEDIAN, write: d.write })

    expect(d.write).toHaveBeenCalledTimes(2)
    for (const [, values] of vi.mocked(d.write!).mock.calls) {
      expect(Object.keys(values).sort()).toEqual(['chainBranch', 'igFollowers', 'prominence'])
    }
  })

  it('en dry-run calcula sin escribir', async () => {
    const d = deps({ write: undefined })
    const [result] = await refreshSignals([row()], d)
    expect(result.status).toBe('changed')
    expect(result.after).toEqual({ igFollowers: 999, chainBranch: false, prominence: expect.closeTo(0.6) })
  })

  it('no escribe si nada cambió', async () => {
    const d = deps({ searchPlace: vi.fn(async () => exa([])) })
    const [result] = await refreshSignals([row({ instagram: null })], d)
    expect(result.status).toBe('unchanged')
    expect(d.write).not.toHaveBeenCalled()
  })

  it('sin instagram no llama a Apify; una cadena (brand_key compartida) usa los seguidores de la marca, descontados', async () => {
    const d = deps()
    const results = await refreshSignals([
      row({ instagram: null }),
      row({ id: 'uuid-2', name: 'La Nueva Roma', instagram: 'lanuevaroma', igFollowers: 5000, brandKey: 'la-nueva-roma' }),
      row({ id: 'uuid-3', name: 'La Nueva Roma', instagram: 'lanuevaroma', brandKey: 'la-nueva-roma' }),
    ], d)

    expect(d.scrapeInstagram).toHaveBeenCalledTimes(2)
    expect(results.map((result) => [result.chain, result.after?.igFollowers, result.after?.chainBranch])).toEqual([[false, null, false], [true, 999, true], [true, 999, true]])
    expect(results[1].after!.prominence).toBeCloseTo(computeProminence({ igFollowers: 999 }, MEDIAN) * 0.85)
  })

  it('el mismo nombre sin brand_key compartida no es cadena: desmarca un chain_branch viejo', async () => {
    const d = deps()
    const results = await refreshSignals([
      row({ id: 'a', name: 'Rosa', instagram: 'rosa.pizzeria', chainBranch: true, brandKey: 'rosa' }),
      row({ id: 'b', name: 'Rosa', instagram: 'rosa.bar' }),
    ], d)
    expect(results.map((result) => [result.id, result.chain, result.after?.chainBranch])).toEqual([['a', false, false], ['b', false, false]])
  })

  it('errores parciales: Exa falla en un lugar y sigue; Apify falla y quedan los seguidores anteriores', async () => {
    const d = deps({
      searchPlace: vi.fn(async (brand: string) => {
        if (brand === 'Roto') throw new Error('timeout')
        return exa(press)
      }),
      scrapeInstagram: vi.fn().mockRejectedValue(new Error('quota')),
    })

    const [broken, ok] = await refreshSignals([row({ id: 'uuid-0', name: 'Roto' }), row({ igFollowers: 321 })], d)

    expect(broken).toMatchObject({ status: 'error', error: 'Exa: timeout', after: null })
    expect(ok.status).toBe('changed')
    expect(ok.after).toEqual({ igFollowers: 321, chainBranch: false, prominence: computeProminence({ igFollowers: 321 }, MEDIAN) })
    expect(ok.warnings[0]).toContain('quota')
    expect(d.write).toHaveBeenCalledTimes(1)
  })

  it('informa una falla al escribir sin cortar el lote', async () => {
    const d = deps({ write: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined) })
    const results = await refreshSignals([row(), row({ id: 'uuid-2', name: 'Otro Lugar' })], d)
    expect(results.map((result) => result.status).sort()).toEqual(['changed', 'error'])
  })

  it('una sucursal de cadena según su web oficial usa los seguidores de la marca, descontados', async () => {
    const d = deps({ searchPlace: vi.fn(async () => exa([{ title: 'Sucursales', url: 'https://elpalenque.com.uy/sucursales', highlights: ['El Palenque: nuestras sucursales'] }])) })
    const [result] = await refreshSignals([row({ website: 'https://www.elpalenque.com.uy/', igFollowers: 5000, prominence: computeProminence({ igFollowers: 5000 }, MEDIAN) })], d)
    expect(result).toMatchObject({ chain: true, after: { igFollowers: 999, chainBranch: true, prominence: expect.closeTo(0.6 * 0.85) } })
    expect(d.scrapeInstagram).toHaveBeenCalledTimes(1)
  })

  it('un tercero que habla de sucursales no la hace cadena', async () => {
    // Bar Tasende: la nota de prensa dice "no tiene sucursales".
    const d = deps({ searchPlace: vi.fn(async () => exa([{ title: 'Bar Tasende, 90 años', url: 'https://www.elobservador.com.uy/nota/tasende', highlights: ['Colgó un cartel en la entrada: "no tiene sucursales".'] }])) })
    const [result] = await refreshSignals([row({ website: 'https://www.elpalenque.com.uy/', chainBranch: true })], d)
    expect(result).toMatchObject({ chain: false, after: { chainBranch: false } })
  })

  it('busca en Exa con la marca y el tipo de lugar de Google; si Google falla, sólo con la marca', async () => {
    const d = deps({ placeType: vi.fn(async (id: string) => {
      if (id === 'g-2') throw new Error('quota')
      return 'Restaurante'
    }) })
    const [first, second] = await refreshSignals([row(), row({ id: 'uuid-2', googlePlaceId: 'g-2', name: 'Musse' })], d)
    expect(d.searchPlace).toHaveBeenCalledWith('El Palenque restaurante')
    expect(d.searchPlace).toHaveBeenCalledWith('Musse')
    expect(first.warnings).toEqual([])
    expect(second.warnings[0]).toContain('Google: quota')
  })

  it('con onlyIds procesa sólo esos, pero cuenta brand_key compartidas sobre todos', async () => {
    const d = deps()
    const results = await refreshSignals([
      row({ id: 'a', name: 'La Nueva Roma', brandKey: 'la-nueva-roma' }),
      row({ id: 'b', name: 'La Nueva Roma', brandKey: 'la-nueva-roma' }),
      row({ id: 'c', name: 'Otro' }),
    ], d, { onlyIds: new Set(['a']) })
    expect(results.map((result) => [result.id, result.chain])).toEqual([['a', true]])
    expect(d.searchPlace).toHaveBeenCalledOnce()
  })
})

describe('signalsFromSnapshots', () => {
  const snapshot = (googlePlaceId: string, followers: number | null, saved: string | null = null, text = 'pizza al corte', url = 'https://www.instagram.com/x/') => ({
    googlePlaceId, sources: [{ id: 'S1', kind: 'instagram' as const, trust: 'official' as const, url, text }], prominenceSignals: followers === null ? null : { instagramFollowers: followers },
    ...(saved ? { instagramAudit: { candidates: [], validated: saved, modelRejected: false, saved } } : {}),
  })

  it('completa sólo los que tienen instagram y no seguidores, sin Apify; es cadena sólo con evidencia', async () => {
    const write = vi.fn(async () => {})
    const results = await signalsFromSnapshots([
      row({ id: 'a', googlePlaceId: 'g-a', name: 'Fundamento', instagram: 'fundamento.pizza' }),
      row({ id: 'b', googlePlaceId: 'g-b', name: 'Único', instagram: 'unico' }),
      row({ id: 'c', googlePlaceId: 'g-c', name: 'Con Seguidores', instagram: 'con', igFollowers: 10 }),
      row({ id: 'd', googlePlaceId: 'g-d', name: 'Sin Instagram', instagram: null }),
    ], [
      snapshot('g-a', 34_390, null, 'en el video están las sucursales de Cordón y Ciudad Vieja', 'https://www.instagram.com/fundamento.pizza/'),
      snapshot('g-b', 999, null, 'nuestras sucursales'),
    ], { igMedian: MEDIAN, write })

    // Fundamento: su Instagram menciona sucursales. Único: las menciona un Instagram que no es el suyo, sin descuento.
    expect(results.map((result) => [result.id, result.status, result.after?.chainBranch])).toEqual([['a', 'changed', true], ['b', 'changed', false]])
    expect(results[0].after!.prominence).toBeCloseTo(computeProminence({ igFollowers: 34_390 }, MEDIAN) * 0.85)
    expect(results[1].after!.prominence).toBeCloseTo(0.6)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('saltea sin snapshot, sin seguidores o de otro Instagram; sin write no escribe', async () => {
    const results = await signalsFromSnapshots([
      row({ id: 'a', googlePlaceId: 'g-a', instagram: 'a' }),
      row({ id: 'b', googlePlaceId: 'g-b', instagram: 'b' }),
      row({ id: 'c', googlePlaceId: 'g-c', instagram: 'c' }),
    ], [snapshot('g-b', null), snapshot('g-c', 50, 'otro')], { igMedian: MEDIAN })
    expect(results.map((result) => [result.id, result.status, result.reason])).toEqual([
      ['a', 'skipped', 'sin snapshot'],
      ['b', 'skipped', 'el snapshot no tiene seguidores'],
      ['c', 'skipped', 'el snapshot es de @otro'],
    ])
  })
})

describe('recomputeChains', () => {
  const source = (url: string, text: string, kind: 'web' | 'exa' | 'instagram' = 'exa') =>
    ({ id: 'S1', kind, trust: kind === 'exa' ? 'third_party' as const : 'official' as const, url, text })
  const snapshot = (googlePlaceId: string, sources: ReturnType<typeof source>[]) => ({ googlePlaceId, sources })

  it('un local único que un tercero llama "sucursal" deja de ser cadena, con la prominencia sin descuento', () => {
    const tasende = row({ id: 'a', googlePlaceId: 'g-a', name: 'Bar Tasende', instagram: 'bartasende', igFollowers: 12_889, chainBranch: true, brandKey: 'bar-tasende', prominence: computeProminence({ igFollowers: 12_889, chainBranch: true }, MEDIAN) })
    const changes = recomputeChains([tasende], [snapshot('g-a', [source('https://www.elobservador.com.uy/nota/tasende', 'No tiene sucursales.')])], MEDIAN)
    expect(changes).toEqual([{ id: 'a', name: 'Bar Tasende', before: expect.objectContaining({ chainBranch: true }), after: { igFollowers: 12_889, chainBranch: false, prominence: computeProminence({ igFollowers: 12_889 }, MEDIAN) }, evidence: [] }])
  })

  it('una cadena con una sola sucursal guardada y otras en su web oficial queda (o pasa a) true', () => {
    const freddo = row({ id: 'a', googlePlaceId: 'g-a', name: 'Freddo', instagram: 'freddouy', website: 'https://uy.freddo.com/', igFollowers: 24_469 })
    const changes = recomputeChains([freddo, { ...freddo, id: 'b', googlePlaceId: 'g-b', name: 'Freddo bis', chainBranch: true }], [
      snapshot('g-a', [source('https://uy.freddo.com/locales/', 'Freddo')]),
      snapshot('g-b', [source('https://uy.freddo.com/store/pocitos/', 'Pocitos')]),
    ], MEDIAN)
    expect(changes.map((change) => [change.id, change.after.chainBranch, change.evidence])).toEqual([['a', true, ['https://uy.freddo.com/locales/']]])
  })

  it('dos lugares con la misma brand_key son cadena aunque no tengan snapshot', () => {
    const changes = recomputeChains([
      row({ id: 'a', googlePlaceId: 'g-a', brandKey: 'la-pasiva' }),
      row({ id: 'b', googlePlaceId: 'g-b', brandKey: 'la-pasiva' }),
    ], [], MEDIAN)
    expect(changes.map((change) => [change.id, change.after.chainBranch, change.evidence])).toEqual([['a', true, ['brand_key la-pasiva']], ['b', true, ['brand_key la-pasiva']]])
  })

  it('sin snapshot ni brand_key compartida, o con chain_branch a mano, no lo toca', () => {
    const changes = recomputeChains([
      row({ id: 'a', googlePlaceId: 'g-a', chainBranch: true }),
      row({ id: 'b', googlePlaceId: 'g-b', chainBranch: true, manualOverrides: { chain_branch: true } }),
    ], [snapshot('g-b', [])], MEDIAN)
    expect(changes).toEqual([])
  })
})
