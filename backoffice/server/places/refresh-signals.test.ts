import { describe, expect, it, vi } from 'vitest'
import type { ExaPlaceResponse, ExaPlaceResult } from '../../src/types/places.ts'
import { refreshSignals, type RefreshDeps, type SignalsRow } from './refresh-signals.ts'

const row = (overrides: Partial<SignalsRow> = {}): SignalsRow => ({
  id: 'uuid-1', name: 'El Palenque', instagram: 'elpalenque', website: 'https://elpalenque.com.uy/',
  editorialMentions: 0, listedOrAwarded: false, igFollowers: null, prominence: 0.125, ...overrides,
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
  it('cuenta las señales con Exa y Apify y escribe sólo las cuatro columnas', async () => {
    const d = deps()

    const [result] = await refreshSignals([row()], d)

    expect(d.searchPlace).toHaveBeenCalledWith('El Palenque')
    expect(d.scrapeInstagram).toHaveBeenCalledWith('https://www.instagram.com/elpalenque/')
    expect(result).toMatchObject({ status: 'changed', chain: false, editorialHosts: ['elpais.com.uy'] })
    expect(d.write).toHaveBeenCalledWith('uuid-1', { editorialMentions: 1, listedOrAwarded: true, igFollowers: 999, prominence: expect.closeTo(0.3 + 0.15 + 0.15) })
  })

  it('en dry-run calcula sin escribir', async () => {
    const d = deps({ write: undefined })
    const [result] = await refreshSignals([row()], d)
    expect(result.status).toBe('changed')
    expect(result.after?.editorialMentions).toBe(1)
  })

  it('no escribe si nada cambió', async () => {
    const d = deps({ searchPlace: vi.fn(async () => exa([])) })
    const [result] = await refreshSignals([row({ instagram: null })], d)
    expect(result.status).toBe('unchanged')
    expect(d.write).not.toHaveBeenCalled()
  })

  it('sin instagram no llama a Apify; una cadena (marca repetida) deja los seguidores en null', async () => {
    const d = deps()
    const results = await refreshSignals([
      row({ instagram: null }),
      row({ id: 'uuid-2', name: 'La Nueva Roma', instagram: 'lanuevaroma', igFollowers: 5000 }),
      row({ id: 'uuid-3', name: 'La Nueva Roma', instagram: 'lanuevaroma' }),
    ], d)

    expect(d.scrapeInstagram).not.toHaveBeenCalled()
    expect(results.map((result) => [result.chain, result.after?.igFollowers])).toEqual([[false, null], [true, null], [true, null]])
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
    expect(ok.after).toMatchObject({ editorialMentions: 1, igFollowers: 321 })
    expect(ok.warnings[0]).toContain('quota')
    expect(d.write).toHaveBeenCalledTimes(1)
  })

  it('informa una falla al escribir sin cortar el lote', async () => {
    const d = deps({ write: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined) })
    const results = await refreshSignals([row(), row({ id: 'uuid-2', name: 'Otro Lugar' })], d)
    expect(results.map((result) => result.status).sort()).toEqual(['changed', 'error'])
  })
})
