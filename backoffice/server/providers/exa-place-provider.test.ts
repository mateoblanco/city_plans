import { describe, expect, it, vi } from 'vitest'
import type { DeepSearchOutput, SearchResponse } from 'exa-js'
import {
  EXA_PLACE_OUTPUT_SCHEMA,
  EXA_PLACE_SEARCH_OPTIONS,
  ExaPlaceSearchProvider,
} from './exa-place-provider.ts'
import { PlacesProviderError } from './places-provider.ts'

const structuredPlace = {
  description: 'Un bar de Montevideo.',
  address: 'Ejemplo 123',
  contact_info: '+598 2 000 0000',
  open_hours_raw: '18:00 a 01:00',
  open_hours: [{ days: 'Mon-Sun', opens: '18:00', closes: '01:00' }],
  knows_before_you_go: 'Conviene reservar.',
  menu: ['Pizza', 'Cerveza'],
}

function exaResult(overrides: Partial<SearchResponse<{ highlights: true }>> = {}) {
  return {
    requestId: 'exa-request-1',
    results: [{ title: 'Demorondanga Bar', url: 'https://example.com', highlights: ['Un bar.'] }],
    output: {
      content: structuredPlace,
      grounding: [{ field: 'name', citations: [], confidence: 'high' }],
    } satisfies DeepSearchOutput,
    ...overrides,
  }
}

describe('ExaPlaceSearchProvider', () => {
  it('consulta el nombre con Montevideo, Uruguay y el schema estructurado requerido', async () => {
    const search = vi.fn().mockResolvedValue(exaResult())
    const provider = new ExaPlaceSearchProvider('exa-test-key', { search })

    await expect(provider.searchPlace('Demorondanga Bar')).resolves.toEqual({
      source: 'exa',
      query: 'Demorondanga Bar, Montevideo, Uruguay',
      output: exaResult().output,
      results: exaResult().results,
      requestId: 'exa-request-1',
      attribution: 'Exa',
    })
    expect(search).toHaveBeenCalledWith(
      'Demorondanga Bar, Montevideo, Uruguay',
      EXA_PLACE_SEARCH_OPTIONS,
    )
    expect(EXA_PLACE_SEARCH_OPTIONS).toMatchObject({
      numResults: 5,
      type: 'auto',
      stream: false,
      contents: { text: { maxCharacters: 2_000 }, highlights: true, extras: { links: 1 } },
      outputSchema: EXA_PLACE_OUTPUT_SCHEMA,
    })
    expect(EXA_PLACE_OUTPUT_SCHEMA).toMatchObject({
      properties: { open_hours_raw: { type: 'string' }, open_hours: { type: 'array' } },
    })
    expect(EXA_PLACE_OUTPUT_SCHEMA.properties.contact_info.description).toContain('Instagram: @handle; Web: https://official-site.example')
  })

  it('informa configuración faltante sin invocar Exa', async () => {
    const provider = new ExaPlaceSearchProvider(undefined)

    await expect(provider.searchPlace('Demorondanga Bar')).rejects.toMatchObject({
      kind: 'configuration',
    } satisfies Partial<PlacesProviderError>)
  })

  it('comparte la promesa por nombre normalizado e invalida con refresh', async () => {
    let resolveSearch!: (value: ReturnType<typeof exaResult>) => void
    const search = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSearch = resolve }))
      .mockResolvedValue(exaResult())
    const provider = new ExaPlaceSearchProvider('exa-test-key', { search })

    const first = provider.searchPlace('Café   Central')
    const second = provider.searchPlace(' cafe central ')
    expect(search).toHaveBeenCalledTimes(1)
    resolveSearch(exaResult())
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)

    await provider.searchPlace('CAFÉ CENTRAL', { refresh: true })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('elimina de la caché las consultas rechazadas', async () => {
    const search = vi.fn()
      .mockRejectedValueOnce({ statusCode: 500 })
      .mockResolvedValueOnce(exaResult())
    const provider = new ExaPlaceSearchProvider('exa-test-key', { search })

    await expect(provider.searchPlace('Demorondanga Bar')).rejects.toMatchObject({ kind: 'upstream' })
    await expect(provider.searchPlace('Demorondanga Bar')).resolves.toMatchObject({ source: 'exa' })
    expect(search).toHaveBeenCalledTimes(2)
  })

  it.each([
    [401, 'authorization'],
    [429, 'quota'],
    [504, 'timeout'],
    [500, 'upstream'],
  ] as const)('normaliza el error HTTP %i como %s', async (statusCode, kind) => {
    const provider = new ExaPlaceSearchProvider('exa-test-key', {
      search: vi.fn().mockRejectedValue({ statusCode }),
    })

    await expect(provider.searchPlace('Demorondanga Bar')).rejects.toMatchObject({ kind })
  })

  it('rechaza una respuesta que no cumple el schema estructurado', async () => {
    const provider = new ExaPlaceSearchProvider('exa-test-key', {
      search: vi.fn().mockResolvedValue({ requestId: 'exa-request-1', results: [] }),
    })

    await expect(provider.searchPlace('Demorondanga Bar')).rejects.toMatchObject({
      kind: 'upstream',
      message: 'Exa devolvió una respuesta estructurada inválida.',
    })
  })
})
