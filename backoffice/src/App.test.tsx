import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import App from './App'

vi.mock('@/components/search-combobox', () => ({
  SearchCombobox: ({
    label,
    options,
    value,
    onChange,
  }: {
    label: string
    options: { value: string; label: string }[]
    value: string
    onChange: (value: string) => void
  }) => (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Seleccionar</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}))

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

async function selectCriteria() {
  const user = userEvent.setup()
  await user.selectOptions(screen.getByLabelText('Barrio'), 'Pocitos')
  await user.selectOptions(screen.getByLabelText('Categoría'), 'restaurant')
  return user
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('City Plans Backoffice', () => {
  it('no consulta hasta tener criterios y presionar buscar', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      new Promise<Response>(() => undefined),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    expect(screen.getByRole('button', { name: 'Buscar lugares' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()

    const user = await selectCriteria()
    expect(screen.getByRole('button', { name: 'Buscar lugares' })).toBeEnabled()
    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      mode: 'filters',
      barrio: 'Pocitos',
      placeType: 'restaurant',
    })
  })

  it('busca por texto libre como modo alternativo', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ items: [], nextPageToken: null }),
    )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Texto libre' }))
    const input = screen.getByLabelText('Nombre del lugar')
    await user.type(input, 'Café Brasilero')
    await user.selectOptions(screen.getByLabelText('Categoría semilla'), 'cafe')
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      mode: 'text',
      query: 'Café Brasilero',
      seedCategory: 'cafe',
    })
  })

  it('carga páginas automáticamente y deduplica por placeId', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          items: [
            { placeId: '1', name: 'Uno', type: 'Restaurante', googleMapsUri: 'https://maps/1' },
            { placeId: '2', name: 'Dos', type: 'Restaurante', googleMapsUri: 'https://maps/2' },
          ],
          nextPageToken: 'next',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          items: [
            { placeId: '2', name: 'Dos', type: 'Restaurante', googleMapsUri: 'https://maps/2' },
            { placeId: '3', name: 'Tres', type: 'Restaurante', googleMapsUri: 'https://maps/3' },
          ],
          nextPageToken: null,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const user = await selectCriteria()
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))

    expect(await screen.findByText('3 lugares')).toBeInTheDocument()
    expect(screen.getByText('2 páginas consultadas')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('link')).toHaveLength(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ pageToken: 'next' })
  })

  it('conserva resultados parciales y reanuda desde el token fallido', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        jsonResponse({
          items: [
            { placeId: '1', name: 'Uno', type: 'Restaurante', googleMapsUri: 'https://maps/1' },
          ],
          nextPageToken: 'retry-token',
        }),
      )
      .mockImplementationOnce(() =>
        jsonResponse(
          { error: { code: 'UPSTREAM_ERROR', message: 'Google no respondió.' } },
          502,
        ),
      )
      .mockImplementationOnce(() =>
        jsonResponse({
          items: [
            { placeId: '2', name: 'Dos', type: 'Restaurante', googleMapsUri: 'https://maps/2' },
          ],
          nextPageToken: null,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const user = await selectCriteria()
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))

    expect(await screen.findByText('La búsqueda quedó incompleta')).toBeInTheDocument()
    expect(screen.getByText('Uno')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('2 lugares')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('La búsqueda quedó incompleta')).not.toBeInTheDocument())
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      pageToken: 'retry-token',
    })
  })

  it('muestra el estado vacío', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => jsonResponse({ items: [], nextPageToken: null })),
    )
    render(<App />)

    const user = await selectCriteria()
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))

    expect(await screen.findByText('No encontramos lugares')).toBeInTheDocument()
  })

  it('abre la modal e inicia Google, Exa y extracción sin esperas intermedias', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/places/search') {
        return jsonResponse({
          items: [{
            placeId: 'place-1',
            name: 'Café Brasilero',
            type: 'Café',
            googleMapsUri: 'https://maps/1',
            seedCategories: ['cafe'],
          }],
          nextPageToken: null,
        })
      }
      if (url.includes('/google-details')) {
        return jsonResponse({
          source: 'google',
          exactMatch: true,
          anchor: {
            name: 'Café Brasilero',
            address: 'Ituzaingó 1447',
            latitude: -34.906,
            longitude: -56.202,
          },
          data: { id: 'place-1', rating: 4.7 },
          websiteUri: 'https://cafebrasilero.com.uy/',
          attribution: 'Google Maps',
        })
      }
      if (url === '/api/places/exa') {
        return jsonResponse({
          source: 'exa',
          query: 'Café Brasilero, Montevideo, Uruguay',
          output: {
            content: {
              name: 'Café Brasilero',
              description: 'Café histórico de Montevideo.',
              address: 'Ituzaingó 1447',
              contact_info: 'Teléfono',
              open_hours_raw: '09:00 a 23:00', open_hours: [{ days: 'Mon-Sun', opens: '09:00', closes: '23:00' }],
              knows_before_you_go: 'Puede haber espera.',
              menu: ['Café', 'Bizcochos'],
            },
            grounding: [],
          },
          results: [],
          requestId: 'exa-request-1',
          attribution: 'Exa',
        })
      }
      if (url.includes('/extract')) {
        return jsonResponse({
          source: 'llm',
          status: 'ok',
          model: 'gpt-5-mini',
          place: {
            name: 'Café Brasilero', address: 'Ituzaingó 1447', coordinates: { lat: -34.906, lng: -56.202, source: 'google', fetchedAt: '2026-10-01T00:00:00.000Z' },
            neighborhoodId: 'CIUDAD VIEJA', city: 'Montevideo', googlePlaceId: 'place-1',
            transit: { status: 'success', lines: [{ line: '121', stopId: '1234', meters: 80 }] },
            categories: ['cafe'], tags: [],
            dietary: { vegan: 'unknown', vegetarian: 'unknown', glutenFree: 'unknown' },
            price: 'unknown', reservations: 'unknown', hours: { raw: null, display: null, slots: [], status: 'none', source: null },
            contact: { phone: null, whatsapp: null, instagram: null, website: null, menuUrl: null, reservationUrl: null },
            highlights: [], description: { es: 'Un café histórico.', en: 'A historic café.' }, placeFacts: [], searchText: 'Café Brasilero.',
          },
          sourceAudit: { google: true, exa: true, instagram: true, instagramCandidates: ['cafebrasilero'] },
          attribution: 'Exa · Instagram vía Apify',
        })
      }
      const source = url.split('/').at(-1)
      return jsonResponse({
        source,
        matchMethod: 'spatial_name_v2',
        bestMatch: null,
        candidates: [],
        attribution: source,
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const user = await selectCriteria()
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))
    await user.click(await screen.findByRole('button', {
      name: 'Buscar información de Café Brasilero',
    }))

    expect(await screen.findByText('Información multi-fuente')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getByRole('tab', { name: 'Info' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Google Places' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Exa' })).toBeVisible()
    expect(screen.getByText(/"rating": 4.7/)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Info' }))
    expect(await screen.findByText('Borrador estructurado disponible')).toBeInTheDocument()
    expect(screen.getByText(/"neighborhoodId": "CIUDAD VIEJA"/)).toBeInTheDocument()
    expect(screen.getByText(/"line": "121"/)).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Exa' }))
    expect(screen.getByText(/"contact_info": "Teléfono"/)).toBeInTheDocument()
    const startedUrls = fetchMock.mock.calls.slice(1).map(([input]) => String(input))
    expect(startedUrls).toEqual(expect.arrayContaining([
      '/api/places/exa',
      '/api/extract',
      '/api/places/place-1/google-details',
    ]))
    const extractionCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/extract'))
    expect(JSON.parse(String(extractionCall?.[1]?.body))).toEqual({
      googlePlaceId: 'place-1',
      seedCategories: ['cafe'],
    })
  })

  it('reintenta la extracción llamando de nuevo a /api/extract con el mismo lugar', async () => {
    let extractionRuns = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/places/search') {
        return jsonResponse({
          items: [{
            placeId: 'place-1',
            name: 'Café Central',
            type: 'Café',
            googleMapsUri: 'https://maps/1',
            seedCategories: ['cafe'],
          }],
          nextPageToken: null,
        })
      }
      if (url.includes('/google-details')) {
        return jsonResponse({
          source: 'google',
          exactMatch: true,
          anchor: {
            name: 'Café Central',
            address: '18 de Julio 1234',
            latitude: -34.9,
            longitude: -56.16,
          },
          websiteUri: 'https://cafe.example/',
          data: { id: 'place-1' },
          attribution: 'Google Maps',
        })
      }
      if (url === '/api/places/exa') {
        return jsonResponse({
          source: 'exa', query: 'Café Central, Montevideo, Uruguay',
          output: {
            content: {
              name: 'Café Central', description: 'Un café.', address: '18 de Julio 1234',
              contact_info: '', open_hours_raw: '', open_hours: [], knows_before_you_go: '', menu: [],
            },
            grounding: [],
          },
          results: [{ url: 'https://cafe.example/noticia', highlights: ['Café Central en Montevideo'] }],
          requestId: 'exa-1', attribution: 'Exa',
        })
      }
      if (url.includes('/extract')) {
        extractionRuns += 1
        const request = JSON.parse(String(init?.body))
        expect(url).toBe('/api/extract')
        expect(request).toEqual({ googlePlaceId: 'place-1', seedCategories: ['cafe'] })
        if (extractionRuns === 1) {
          return jsonResponse({ error: { code: 'UPSTREAM_ERROR', message: 'Falló la extracción.' } }, 502)
        }
        return jsonResponse({
          source: 'llm', status: 'no_sources', model: 'gpt-5-mini',
          sourceAudit: { google: true, exa: false, instagram: false, instagramCandidates: [] },
          attribution: 'Sin fuentes textuales',
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const user = await selectCriteria()
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))
    await user.click(await screen.findByRole('button', {
      name: 'Buscar información de Café Central',
    }))
    await user.click(await screen.findByRole('tab', { name: 'Info' }))

    expect(await screen.findByText('Falló la extracción.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText('No hay fuentes Exa o Instagram para enriquecer.')).toBeInTheDocument()
    expect(extractionRuns).toBe(2)
  })

  it('muestra el error de Exa y reintenta sólo esa fuente', async () => {
    let exaRuns = 0
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/places/search') {
        return jsonResponse({
          items: [{
            placeId: 'place-1',
            name: 'Café Central',
            type: 'Café',
            googleMapsUri: 'https://maps/1',
            seedCategories: ['cafe'],
          }],
          nextPageToken: null,
        })
      }
      if (url.includes('/google-details')) {
        return jsonResponse({
          source: 'google',
          exactMatch: true,
          anchor: { name: 'Café Central', address: '18 de Julio 1234', latitude: -34.9, longitude: -56.16 },
          websiteUri: null,
          data: { id: 'place-1' },
          attribution: 'Google Maps',
        })
      }
      if (url === '/api/places/exa') {
        exaRuns += 1
        expect(JSON.parse(String(init?.body))).toEqual({
          name: 'Café Central',
          refresh: exaRuns > 1,
        })
        if (exaRuns === 1) {
          return jsonResponse(
            { error: { code: 'QUOTA_ERROR', message: 'Exa limitó temporalmente las consultas.' } },
            429,
          )
        }
        return jsonResponse({
          source: 'exa',
          query: 'Café Central, Montevideo, Uruguay',
          output: {
            content: {
              name: 'Café Central', description: 'Un café.', address: '18 de Julio 1234',
              contact_info: 'Teléfono', open_hours_raw: '08:00 a 20:00', open_hours: [{ days: 'Mon-Sun', opens: '08:00', closes: '20:00' }],
              knows_before_you_go: 'Sin reservas.', menu: ['Café'],
            },
            grounding: [],
          },
          results: [],
          requestId: 'exa-request-2',
          attribution: 'Exa',
        })
      }
      if (url.includes('/extract')) {
        return jsonResponse({
          source: 'llm', status: 'no_sources', model: 'gpt-5-mini',
          sourceAudit: { google: true, exa: false, instagram: false, instagramCandidates: [] },
          attribution: 'Sin fuentes textuales',
        })
      }
      return jsonResponse({
        source: 'openstreetmap', matchMethod: 'spatial_name_v2', bestMatch: null, candidates: [],
        attribution: '© OpenStreetMap contributors · ODbL',
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)

    const user = await selectCriteria()
    await user.click(screen.getByRole('button', { name: 'Buscar lugares' }))
    await user.click(await screen.findByRole('button', { name: 'Buscar información de Café Central' }))
    await user.click(await screen.findByRole('tab', { name: 'Exa' }))

    expect(await screen.findByText('Exa limitó temporalmente las consultas.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))

    expect(await screen.findByText(/"requestId": "exa-request-2"/)).toBeInTheDocument()
    expect(exaRuns).toBe(2)
  })
})
