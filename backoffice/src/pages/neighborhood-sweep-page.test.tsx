import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { NeighborhoodSweepEvent, NeighborhoodSweepSummary, PlaceGroup } from '@/types/places'

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

const place = {
  placeId: 'p1',
  name: 'Bar Uno',
  type: 'Bar',
  googleMapsUri: 'https://maps/p1',
  seedCategories: ['bar' as const, 'wine_bar' as const],
  googleTypes: ['bar'],
  foundBy: ['bar:tragos', 'wine_bar:vinoteca'],
  insideNeighborhood: true as boolean | null,
  group: 'accepted' as PlaceGroup | null,
  reason: null as string | null,
  primaryType: 'bar' as string | null,
  rating: 4.5 as number | null,
  userRatingCount: 120 as number | null,
}

function summary(overrides: Partial<NeighborhoodSweepSummary> = {}): NeighborhoodSweepSummary {
  return {
    neighborhoodId: 'PARQUE RODO',
    mode: 'full',
    totalPlaces: 1,
    bySeedCategory: { bar: 1, wine_bar: 1 },
    byGroup: { accepted: 1, review: 0, rejected: 0 },
    byReason: {},
    unknownTypes: {},
    newByQuery: { 'bar:tragos': 1, 'wine_bar:vinoteca': 0 },
    saturatedCells: [],
    discardedOutside: 2,
    apiCalls: { sweep: 18, rescue: 0 },
    failedCalls: [],
    failedCallCount: 0,
    failedPageCount: 0,
    truncated: false,
    maxCalls: 1500,
    ...overrides,
  }
}

function ndjson(events: NeighborhoodSweepEvent[]) {
  return Promise.resolve(
    new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n', {
      status: 200,
      headers: { 'Content-Type': 'application/x-ndjson' },
    }),
  )
}

async function startSweep(mode?: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('link', { name: 'Buscar por barrio' }))
  if (mode) await user.click(screen.getByRole('button', { name: mode }))
  await user.selectOptions(screen.getByLabelText('Barrio'), 'PARQUE RODO')
  await user.click(screen.getByRole('button', { name: 'Buscar todos los lugares' }))
  await user.click(await screen.findByRole('button', { name: 'Empezar recorrido' }))
  return user
}

beforeEach(() => {
  window.location.hash = ''
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Buscar por barrio', () => {
  it('se navega desde el menú lateral y pide confirmación antes de consultar', async () => {
    const fetchMock = vi.fn(() => ndjson([]))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    const user = userEvent.setup()

    expect(screen.getByRole('link', { name: 'Buscar lugares' })).toHaveAttribute('aria-current', 'page')
    await user.click(screen.getByRole('link', { name: 'Buscar por barrio' }))
    expect(screen.getByRole('heading', { name: 'Todos los lugares de un barrio' })).toBeInTheDocument()
    expect(screen.getByText('Elegí un barrio para empezar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buscar todos los lugares' })).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Barrio'), 'PARQUE RODO')
    await user.click(screen.getByRole('button', { name: 'Buscar todos los lugares' }))
    expect(await screen.findByText('¿Recorrer Parque Rodó?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lista los lugares del barrio con categorías, resumen y atribución', async () => {
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => ndjson([
      { type: 'start', neighborhoodId: 'PARQUE RODO', mode: 'full', maxCalls: 1500 },
      { type: 'places', items: [{ ...place, seedCategories: ['bar'], foundBy: ['bar:tragos'] }] },
      { type: 'progress', apiCalls: { sweep: 18, rescue: 0 }, totalPlaces: 1, discardedOutside: 2, currentQuery: 'wine_bar:vinoteca' },
      { type: 'places', items: [place] },
      { type: 'done', summary: summary() },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await startSweep()

    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/neighborhoods/PARQUE%20RODO/sweep')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ mode: 'full' })
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('Bar, Vinoteca')).toBeInTheDocument()
    expect(within(table).getByText('Bar · tragos · Vinoteca · vinoteca')).toBeInTheDocument()
    expect(screen.getByLabelText('Google Maps')).toBeInTheDocument()
    expect(screen.getByText('Resumen del recorrido')).toBeInTheDocument()
    expect(screen.getByText('Descartados fuera del polígono').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText('Total encontrado').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('Dentro del barrio').nextElementSibling).toHaveTextContent('1')
  })

  it('recorre en modo sólo IDs sin botón de extracción', async () => {
    const idPlace = { ...place, name: 'ChIJ-id-1', placeId: 'ChIJ-id-1', type: 'Sólo ID', googleTypes: [], insideNeighborhood: null, group: null, reason: null, primaryType: null, rating: null, userRatingCount: null }
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => ndjson([
      { type: 'places', items: [idPlace] },
      { type: 'done', summary: summary({ mode: 'ids', discardedOutside: 0, byGroup: null }) },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    render(<App />)
    await startSweep('Sólo IDs (gratis)')

    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ mode: 'ids' })
    expect(screen.getByRole('link', { name: /ChIJ-id-1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buscar información/ })).not.toBeInTheDocument()
    expect(screen.getByText(/puede incluir lugares de barrios vecinos/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Mostrar sólo lugares del barrio')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Grupo del filtro previo' })).not.toBeInTheDocument()
    expect(screen.getByText('Dentro del barrio').nextElementSibling).toHaveTextContent('No disponible en modo IDs')
  })

  it('filtra por defecto los lugares fuera del barrio y permite mostrarlos con el checkbox', async () => {
    const outsidePlace = { ...place, placeId: 'p2', name: 'Bar Vecino', insideNeighborhood: false }
    vi.stubGlobal('fetch', vi.fn(() => ndjson([
      { type: 'places', items: [place, outsidePlace] },
      { type: 'done', summary: summary({ discardedOutside: 1 }) },
    ])))
    render(<App />)
    const user = await startSweep()

    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()
    expect(screen.getByText(/1 dentro del barrio/)).toHaveTextContent('1 dentro del barrio · 2 encontrados en total')
    const checkbox = screen.getByLabelText('Mostrar sólo lugares del barrio')
    expect(checkbox).toBeChecked()
    expect(screen.queryByRole('link', { name: /Bar Vecino/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Ubicación' })).not.toBeInTheDocument()

    await user.click(checkbox)
    expect(screen.getByRole('link', { name: /Bar Vecino/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Ubicación' })).toBeInTheDocument()
    expect(screen.getByText('Fuera del barrio')).toBeInTheDocument()
  })

  it('separa aceptados, para revisar y rechazados, y muestra rating y reseñas sólo en las vistas previas del resumen', async () => {
    const review = { ...place, placeId: 'r1', name: 'Sin Tipo', group: 'review' as const, reason: 'primary_type_missing', primaryType: null, rating: null, userRatingCount: null }
    const rejected = { ...place, placeId: 'x1', name: 'Super Barrio', group: 'rejected' as const, reason: 'excluded_type:supermarket', primaryType: 'supermarket', rating: 3.9, userRatingCount: 57 }
    vi.stubGlobal('fetch', vi.fn(() => ndjson([
      { type: 'places', items: [place, review, rejected] },
      {
        type: 'done',
        summary: summary({
          totalPlaces: 3,
          byGroup: { accepted: 1, review: 1, rejected: 1 },
          byReason: { 'unknown_type:florist': 3, 'excluded_type:supermarket': 1 },
          unknownTypes: { florist: 3, meal_delivery: 1 },
        }),
      },
    ])))
    render(<App />)
    const user = await startSweep()

    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()
    const table = screen.getAllByRole('table')[0]
    expect(within(table).getByRole('link', { name: /Bar Uno/ })).toBeInTheDocument()
    expect(within(table).queryByRole('link', { name: /Super Barrio/ })).not.toBeInTheDocument()
    expect(within(table).queryByText('4.5')).not.toBeInTheDocument()
    expect(within(table).getAllByRole('button', { name: /Buscar información/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Aceptados (1)' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Rechazados (1)' }))
    const rejectedTable = screen.getAllByRole('table')[0]
    expect(within(rejectedTable).getByRole('link', { name: /Super Barrio/ })).toBeInTheDocument()
    expect(within(rejectedTable).getByText('excluded_type:supermarket')).toBeInTheDocument()
    expect(within(rejectedTable).queryByRole('button', { name: /Buscar información/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Para revisar (1)' }))
    expect(within(screen.getAllByRole('table')[0]).getByText('primary_type_missing')).toBeInTheDocument()

    expect(screen.getByText('Rechazados (primeros 1 de 1)')).toBeInTheDocument()
    expect(screen.getByText('Para revisar (primeros 1 de 1)')).toBeInTheDocument()
    expect(screen.getByText('Tipos en revisión sin clasificar')).toBeInTheDocument()
    expect(screen.getByText('florist').nextElementSibling).toHaveTextContent('3')
    expect(screen.getByText('meal_delivery').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText('3.9')).toBeInTheDocument()
    expect(screen.getByText('57')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('muestra el estado vacío', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ndjson([{ type: 'done', summary: summary({ totalPlaces: 0, bySeedCategory: {} }) }])))
    render(<App />)
    await startSweep()
    expect(await screen.findByText('No encontramos lugares')).toBeInTheDocument()
  })

  it('muestra el error inicial con reintento', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar GOOGLE_PLACES_API_KEY en .env.local.' },
    }), { status: 503 }))))
    render(<App />)
    await startSweep()
    expect(await screen.findByText('No pudimos recorrer el barrio')).toBeInTheDocument()
    expect(screen.getByText('Falta configurar GOOGLE_PLACES_API_KEY en .env.local.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('conserva resultados y avisa cuando hubo fallas parciales o tope', async () => {
    vi.stubGlobal('fetch', vi.fn(() => ndjson([
      { type: 'places', items: [place] },
      {
        type: 'done',
        summary: summary({
          truncated: true,
          failedCalls: [
            { key: 'cafe:café', bounds: { south: 0, west: 0, north: 1, east: 1 }, page: 1, message: 'Google Places respondió 500.' },
            { key: 'bar:tragos', bounds: { south: 0, west: 0, north: 1, east: 1 }, page: 2, message: 'Google Places respondió 503.' },
          ],
          failedCallCount: 2,
          failedPageCount: 1,
        }),
      },
    ])))
    render(<App />)
    await startSweep()
    expect(await screen.findByText('El recorrido quedó incompleto')).toBeInTheDocument()
    expect(screen.getByText(/Corrida incompleta: 2 llamadas fallidas\. Se alcanzó el tope de 1500 llamadas/)).toBeInTheDocument()
    expect(screen.getByText('Resumen del recorrido').querySelector('span')).toHaveTextContent('Corrida incompleta: 2 llamadas fallidas')
    expect(screen.getByText('Llamadas fallidas').nextElementSibling).toHaveTextContent('2')
    expect(screen.getByText('Páginas intermedias fallidas').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByRole('link', { name: /Bar Uno/ })).toBeInTheDocument()
  })

  it('muestra la carga y permite cancelar conservando lo encontrado', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'places', items: [place] })}\n`))
          init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
        },
      })
      return Promise.resolve(new Response(body, { status: 200 }))
    }))
    render(<App />)
    const user = await startSweep()

    expect(await screen.findByRole('link', { name: /Bar Uno/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(screen.getByText('El recorrido quedó incompleto')).toBeInTheDocument())
    expect(screen.getByText('Cancelaste el recorrido; los resultados pueden estar incompletos.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Bar Uno/ })).toBeInTheDocument()
  })

  it('procesa los seleccionados de Aceptados y Para revisar con concurrencia 3, estados por fila, reintento y métricas', async () => {
    const accepted = ['a1', 'a2', 'a3', 'a4'].map((id) => ({ ...place, placeId: id, name: `Lugar ${id}` }))
    const review = { ...place, placeId: 'r1', name: 'Lugar r1', group: 'review' as const, reason: 'few_reviews', insideNeighborhood: false }
    const rejected = { ...place, placeId: 'x1', name: 'Lugar x1', group: 'rejected' as const, reason: 'excluded_type:store' }
    const pending: { id: string; resolve: () => void }[] = []
    const extractBodies: Record<string, unknown>[] = []
    const reportBodies: Record<string, unknown>[] = []
    let inFlight = 0
    let maxInFlight = 0
    let a2Attempts = 0
    const result = (id: string) => ({
      source: 'llm', status: 'ok', model: 'anthropic/claude-sonnet-5.5',
      performance: { totalMs: 4000, stepsMs: { google: 1000, llm: 3000 }, costUsd: { totalUsd: 0.1, providers: { llm: { costUsd: 0.04, inputTokens: 10_000, cachedInputTokens: 3_000, cacheWriteTokens: 0 } } } },
      place: {
        googlePlaceId: id, name: `Lugar ${id}`, categories: [], tags: ['wifi', 'events'], placeFacts: [],
        hours: { status: 'none' }, contact: { instagram: null, website: 'https://lugar.example/' },
      },
      review: {
        unmappedFacts: [{ id: 'F1', text: `Karaoke en ${id}`, proposedTag: 'karaoke' }], doubts: [],
        anomalies: [{ type: 'no_contact', detail: 'sin instagram ni website' }], hoursRetry: { attempted: true, recovered: false, costUsd: 0.03 },
      },
    })

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/sweep')) {
        return ndjson([
          { type: 'places', items: [...accepted, review, rejected] },
          { type: 'done', summary: summary({ totalPlaces: 5, byGroup: { accepted: 4, review: 0, rejected: 1 } }) },
        ])
      }
      if (url === '/api/extraction-reports') {
        reportBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Promise.resolve(new Response(JSON.stringify({ path: 'output/report.json' }), { status: 200 }))
      }
      expect(url).toBe('/api/extract')
      const body = JSON.parse(String(init?.body)) as { googlePlaceId: string }
      extractBodies.push(body)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return new Promise<Response>((resolve) => {
        pending.push({
          id: body.googlePlaceId,
          resolve: () => {
            inFlight -= 1
            if (body.googlePlaceId === 'a2' && (a2Attempts += 1) === 1) {
              resolve(new Response(JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'Falló a2' } }), { status: 502 }))
            } else {
              resolve(new Response(JSON.stringify(result(body.googlePlaceId)), { status: 200 }))
            }
          },
        })
      })
    }))
    render(<App />)
    const user = await startSweep()
    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Procesar (0)' })).toBeDisabled()
    await user.click(screen.getByLabelText('Seleccionar todos'))
    await user.click(screen.getByLabelText('Mostrar sólo lugares del barrio'))
    await user.click(screen.getByRole('button', { name: /Para revisar/ }))
    await user.click(screen.getByLabelText('Seleccionar Lugar r1'))
    await user.click(screen.getByRole('button', { name: /Rechazados/ }))
    expect(screen.queryByLabelText('Seleccionar todos')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Aceptados/ }))

    await user.click(screen.getByRole('button', { name: 'Procesar (5)' }))
    await waitFor(() => expect(pending).toHaveLength(3))
    const mainTable = () => screen.getAllByRole('table')[0]
    expect(within(mainTable()).getAllByText('Procesando…')).toHaveLength(3)
    expect(within(mainTable()).getByText('En cola')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Procesar (5)' })).toBeDisabled()

    while (pending.length > 0 || extractBodies.length < 5) {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0))
      pending.shift()?.resolve()
    }

    const metrics = await screen.findByRole('region', { name: 'Métricas del procesamiento' })
    expect(maxInFlight).toBe(3)
    expect(extractBodies).toHaveLength(5)
    expect(extractBodies.find((body) => body.googlePlaceId === 'a1')).toEqual({
      googlePlaceId: 'a1', seedCategories: ['bar', 'wine_bar'], neighborhoodId: 'PARQUE RODO',
    })
    expect(extractBodies.find((body) => body.googlePlaceId === 'r1')).toEqual({ googlePlaceId: 'r1', seedCategories: ['bar', 'wine_bar'] })
    // Al terminar el lote se manda un reporte con la revisión de los lugares listos.
    await waitFor(() => expect(reportBodies).toHaveLength(1))
    expect(reportBodies[0].places).toHaveLength(4)
    expect((reportBodies[0].places as { googlePlaceId: string; review: unknown }[]).find((entry) => entry.googlePlaceId === 'a1')).toEqual({
      name: 'Lugar a1', googlePlaceId: 'a1',
      stats: {
        hoursStatus: 'none', hasInstagram: false, hasWebsite: true, tagCount: 2, costUsd: 0.1, totalMs: 4000,
        sourcesUsd: expect.closeTo(0.03, 6), mainLlmUsd: 0.04, hoursRetryUsd: 0.03, inputTokens: 10_000, cachedInputTokens: 3_000, cacheWriteTokens: 0,
      },
      review: {
        unmappedFacts: [{ id: 'F1', text: 'Karaoke en a1', proposedTag: 'karaoke' }], doubts: [],
        anomalies: [{ type: 'no_contact', detail: 'sin instagram ni website' }], hoursRetry: { attempted: true, recovered: false, costUsd: 0.03 },
      },
    })
    expect(within(metrics).getByText('Listos').nextElementSibling).toHaveTextContent('4')
    expect(within(metrics).getByText('Con error').nextElementSibling).toHaveTextContent('1')
    expect(within(metrics).getByText('Google').nextElementSibling).toHaveTextContent('1,0 s')
    expect(within(metrics).getByText('LLM').nextElementSibling).toHaveTextContent('3,0 s')
    expect(within(mainTable()).getByText('Error: Falló a2')).toBeInTheDocument()
    expect(within(mainTable()).getAllByText(/^Listo · /)).toHaveLength(3)

    const a1Row = within(mainTable()).getByRole('link', { name: /Lugar a1/ }).closest('tr') as HTMLElement
    await user.click(within(a1Row).getByRole('button', { name: 'Ver resultado' }))
    const resultDialog = await screen.findByRole('dialog', { name: 'Resultado del pipeline' })
    expect(within(resultDialog).getByText('Borrador estructurado disponible')).toBeInTheDocument()
    expect(within(resultDialog).getByText(/"googlePlaceId": "a1"/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Resultado del pipeline' })).not.toBeInTheDocument())

    const a2Row = within(mainTable()).getByRole('link', { name: /Lugar a2/ }).closest('tr') as HTMLElement
    await user.click(within(a2Row).getByRole('button', { name: 'Ver resultado' }))
    const errorDialog = await screen.findByRole('dialog', { name: 'Resultado del pipeline' })
    expect(within(errorDialog).getByText('Falló a2')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Resultado del pipeline' })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Reintentar fallidos (1)' }))
    await waitFor(() => expect(pending).toHaveLength(1))
    expect(pending[0].id).toBe('a2')
    pending.shift()?.resolve()
    await waitFor(() => expect(within(mainTable()).getAllByText(/^Listo · /)).toHaveLength(4))
    expect(extractBodies).toHaveLength(6)
    // El reintento también es un lote y genera su propio reporte.
    await waitFor(() => expect(reportBodies).toHaveLength(2))
    expect(reportBodies[1].places).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Reintentar fallidos/ })).not.toBeInTheDocument()
  })

  it('muestra la tab Procesados con lo del lote y guarda los seleccionados en la base', async () => {
    const ok = { ...place, placeId: 'a1', name: 'Lugar a1' }
    const broken = { ...place, placeId: 'a2', name: 'Lugar a2' }
    const saveBodies: { results: { status: string; place: { googlePlaceId: string } }[] }[] = []
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
      if (url.includes('/sweep')) {
        return ndjson([
          { type: 'places', items: [ok, broken] },
          { type: 'done', summary: summary({ totalPlaces: 2, byGroup: { accepted: 2, review: 0, rejected: 0 } }) },
        ])
      }
      if (url === '/api/extraction-reports') return json({ path: 'output/report.json' })
      if (url.startsWith('/api/places/exists')) return json({ ids: [] })
      if (url === '/api/places') {
        saveBodies.push(JSON.parse(String(init?.body)))
        return json({ results: [{ googlePlaceId: 'a1', id: 'uuid-1', action: 'created', embedded: true }] })
      }
      const body = JSON.parse(String(init?.body)) as { googlePlaceId: string }
      if (body.googlePlaceId === 'a2') return json({ error: { code: 'UPSTREAM_ERROR', message: 'Falló a2' } }, 502)
      return json({
        source: 'llm', status: 'ok', model: 'anthropic/claude-sonnet-5.5',
        performance: { totalMs: 1000, stepsMs: {}, costUsd: { totalUsd: 0.1, providers: { llm: { costUsd: 0.04 } } } },
        place: { googlePlaceId: 'a1', name: 'Lugar a1', categories: ['bar'], tags: [], placeFacts: [], hours: { status: 'exact' }, contact: { instagram: null, website: null } },
        review: { unmappedFacts: [], doubts: [], anomalies: [], hoursRetry: { attempted: false, recovered: false, costUsd: 0 } },
      })
    }))
    render(<App />)
    const user = await startSweep()
    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Procesados/ })).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Seleccionar todos'))
    await user.click(screen.getByRole('button', { name: 'Procesar (2)' }))
    await user.click(await screen.findByRole('button', { name: 'Procesados (2)' }))

    expect(screen.queryByRole('button', { name: /^Procesar/ })).not.toBeInTheDocument()
    expect(await screen.findByText('nuevo')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Lugar a2' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Guardar seleccionados (1)' }))

    expect(await screen.findByText('1 creados, 0 actualizados, 0 sin embedding, 0 errores')).toBeInTheDocument()
    expect(screen.getByText('guardado')).toBeInTheDocument()
    expect(saveBodies).toHaveLength(1)
    expect(saveBodies[0].results.map((result) => result.place.googlePlaceId)).toEqual(['a1'])

    await user.click(screen.getByRole('button', { name: /Aceptados/ }))
    expect(screen.getByRole('button', { name: /^Procesar/ })).toBeInTheDocument()
  })
})
