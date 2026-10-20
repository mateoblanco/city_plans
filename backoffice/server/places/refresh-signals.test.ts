import { describe, expect, it, vi } from 'vitest'
import type { ExaPlaceResponse, ExaPlaceResult } from '../../src/types/places.ts'
import { computeProminence } from './prominence.ts'
import { refreshSignals, signalsFromSnapshots, type RefreshDeps, type SignalsRow } from './refresh-signals.ts'

const row = (overrides: Partial<SignalsRow> = {}): SignalsRow => ({
  id: 'uuid-1', googlePlaceId: 'g-1', name: 'El Palenque', instagram: 'elpalenque',
  igFollowers: null, chainBranch: false, prominence: computeProminence({ igFollowers: null }), ...overrides,
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

  it('sin instagram no llama a Apify; una cadena (marca repetida) usa los seguidores de la marca, descontados', async () => {
    const d = deps()
    const results = await refreshSignals([
      row({ instagram: null }),
      row({ id: 'uuid-2', name: 'La Nueva Roma', instagram: 'lanuevaroma', igFollowers: 5000 }),
      row({ id: 'uuid-3', name: 'La Nueva Roma', instagram: 'lanuevaroma' }),
    ], d)

    expect(d.scrapeInstagram).toHaveBeenCalledTimes(2)
    expect(results.map((result) => [result.chain, result.after?.igFollowers, result.after?.chainBranch])).toEqual([[false, null, false], [true, 999, true], [true, 999, true]])
    expect(results[1].after!.prominence).toBeCloseTo(computeProminence({ igFollowers: 999 }) * 0.85)
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
    expect(ok.after).toEqual({ igFollowers: 321, chainBranch: false, prominence: computeProminence({ igFollowers: 321 }) })
    expect(ok.warnings[0]).toContain('quota')
    expect(d.write).toHaveBeenCalledTimes(1)
  })

  it('informa una falla al escribir sin cortar el lote', async () => {
    const d = deps({ write: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined) })
    const results = await refreshSignals([row(), row({ id: 'uuid-2', name: 'Otro Lugar' })], d)
    expect(results.map((result) => result.status).sort()).toEqual(['changed', 'error'])
  })

  it('una sucursal de cadena según las fuentes usa los seguidores de la marca, descontados', async () => {
    const d = deps({ searchPlace: vi.fn(async () => exa([{ title: 'Sucursales', url: 'https://elpalenque.com.uy/sucursales', highlights: ['El Palenque: nuestras sucursales'] }])) })
    const [result] = await refreshSignals([row({ igFollowers: 5000, prominence: computeProminence({ igFollowers: 5000 }) })], d)
    expect(result).toMatchObject({ chain: true, after: { igFollowers: 999, chainBranch: true, prominence: expect.closeTo(0.6 * 0.85) } })
    expect(d.scrapeInstagram).toHaveBeenCalledTimes(1)
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

  it('con onlyIds procesa sólo esos, pero cuenta marcas repetidas sobre todos', async () => {
    const d = deps()
    const results = await refreshSignals([
      row({ id: 'a', name: 'La Nueva Roma' }),
      row({ id: 'b', name: 'La Nueva Roma' }),
      row({ id: 'c', name: 'Otro' }),
    ], d, { onlyIds: new Set(['a']) })
    expect(results.map((result) => [result.id, result.chain])).toEqual([['a', true]])
    expect(d.searchPlace).toHaveBeenCalledOnce()
  })
})

describe('signalsFromSnapshots', () => {
  const snapshot = (googlePlaceId: string, followers: number | null, saved: string | null = null, text = 'pizza al corte') => ({
    googlePlaceId, sources: [{ id: 'S1', kind: 'instagram' as const, trust: 'official' as const, url: 'https://www.instagram.com/x/', text }], prominenceSignals: followers === null ? null : { instagramFollowers: followers },
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
      snapshot('g-a', 34_390, null, 'en el video están las sucursales de Cordón y Ciudad Vieja'),
      snapshot('g-b', 999),
    ], { write })

    // Fundamento: el snapshot menciona sucursales. Único: sin evidencia, sin descuento.
    expect(results.map((result) => [result.id, result.status, result.after?.chainBranch])).toEqual([['a', 'changed', true], ['b', 'changed', false]])
    expect(results[0].after!.prominence).toBeCloseTo(computeProminence({ igFollowers: 34_390 }) * 0.85)
    expect(results[1].after!.prominence).toBeCloseTo(0.6)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('saltea sin snapshot, sin seguidores o de otro Instagram; sin write no escribe', async () => {
    const results = await signalsFromSnapshots([
      row({ id: 'a', googlePlaceId: 'g-a', instagram: 'a' }),
      row({ id: 'b', googlePlaceId: 'g-b', instagram: 'b' }),
      row({ id: 'c', googlePlaceId: 'g-c', instagram: 'c' }),
    ], [snapshot('g-b', null), snapshot('g-c', 50, 'otro')])
    expect(results.map((result) => [result.id, result.status, result.reason])).toEqual([
      ['a', 'skipped', 'sin snapshot'],
      ['b', 'skipped', 'el snapshot no tiene seguidores'],
      ['c', 'skipped', 'el snapshot es de @otro'],
    ])
  })
})
