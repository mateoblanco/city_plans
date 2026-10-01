import { describe, expect, it, vi } from 'vitest'
import { ApifyGoogleSearchProvider } from './apify-google-search-provider.ts'

describe('ApifyGoogleSearchProvider', () => {
  it('consulta una sola página uruguaya y normaliza resultados orgánicos', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      {
        organicResults: [
          {
            position: 2,
            title: 'Segundo',
            url: 'https://second.example/',
            description: 'Descripción 2',
          },
          {
            position: 1,
            title: 'Primero',
            url: 'https://first.example/',
            description: 'Descripción 1',
          },
          { title: 'Sin URL' },
        ],
      },
    ]), { status: 200 }))
    const provider = new ApifyGoogleSearchProvider({ token: 'secret-token' }, fetcher)

    const result = await provider.search('"Café Central" Montevideo')

    expect(result.map((item) => item.title)).toEqual(['Primero', 'Segundo'])
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toContain('/v2/actors/apify~google-search-scraper/run-sync-get-dataset-items')
    expect(new URL(String(url)).searchParams.get('timeout')).toBe('120')
    expect(init.headers.Authorization).toBe('Bearer secret-token')
    expect(JSON.parse(init.body)).toEqual({
      queries: '"Café Central" Montevideo',
      maxPagesPerQuery: 1,
      countryCode: 'uy',
      languageCode: 'es',
      mobileResults: false,
      includeUnfilteredResults: false,
      saveHtml: false,
    })
  })

  it.each([
    [401, 'authorization'],
    [402, 'quota'],
    [429, 'quota'],
    [504, 'timeout'],
  ] as const)('normaliza el error HTTP %s', async (status, kind) => {
    const provider = new ApifyGoogleSearchProvider(
      { token: 'secret' },
      vi.fn().mockResolvedValue(new Response('', { status })),
    )

    await expect(provider.search('consulta')).rejects.toMatchObject({ kind })
  })

  it('informa configuración y conserva el detalle seguro de Apify', async () => {
    await expect(new ApifyGoogleSearchProvider({}).search('consulta'))
      .rejects.toMatchObject({ kind: 'configuration' })

    const provider = new ApifyGoogleSearchProvider(
      { token: 'secret' },
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: { message: 'Actor input is invalid.' },
      }), { status: 400 })),
    )
    await expect(provider.search('consulta')).rejects.toMatchObject({
      kind: 'upstream',
      message: 'Apify no pudo completar la búsqueda en Google. Actor input is invalid.',
    })
  })

  it('clasifica como timeout una ejecución abortada por Apify', async () => {
    const provider = new ApifyGoogleSearchProvider(
      { token: 'secret' },
      vi.fn().mockResolvedValue(new Response(JSON.stringify({
        error: {
          message: 'Actor run did not succeed (run ID: run-1, status: TIMED-OUT).',
        },
      }), { status: 400 })),
    )

    await expect(provider.search('Vermutería')).rejects.toMatchObject({
      kind: 'timeout',
      message: 'Google Search demoró demasiado en responder en Apify.',
    })
  })
})
