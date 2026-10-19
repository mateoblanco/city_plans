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

  it('oculta por defecto los que ya están en la base, con una sola consulta, y los muestra al desactivar el checkbox', async () => {
    const saved = { ...place, placeId: 'a1', name: 'Lugar guardado' }
    const fresh = ['a2', 'a3'].map((id) => ({ ...place, placeId: id, name: `Lugar ${id}` }))
    const outside = { ...place, placeId: 'a4', name: 'Lugar vecino', insideNeighborhood: false }
    const existsBodies: { ids: string[] }[] = []
    const extractBodies: { googlePlaceId: string }[] = []
    let releaseExists!: () => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
      if (url.includes('/sweep')) {
        return ndjson([
          { type: 'places', items: [saved, ...fresh, outside] },
          { type: 'done', summary: summary({ totalPlaces: 4, byGroup: { accepted: 4, review: 0, rejected: 0 } }) },
        ])
      }
      if (url === '/api/places/exists') {
        existsBodies.push(JSON.parse(String(init?.body)))
        // Se demora para poder seleccionar antes de que llegue la respuesta.
        return new Promise<Response>((resolve) => { releaseExists = () => resolve(new Response(JSON.stringify({ ids: ['a1', 'a4'] }), { status: 200 })) })
      }
      if (url === '/api/extraction-reports') return json({ path: 'output/report.json' })
      extractBodies.push(JSON.parse(String(init?.body)))
      return Promise.resolve(new Response(JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'sin pipeline en el test' } }), { status: 502 }))
    }))
    render(<App />)
    const user = await startSweep()
    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()

    // Mientras consulta, todo se ve y se puede seleccionar.
    expect(screen.getByText('· Consultando la base…')).toBeInTheDocument()
    const hide = screen.getByLabelText('Ocultar los que ya están en la base')
    expect(hide).toBeChecked()
    await user.click(screen.getByLabelText('Seleccionar todos'))
    expect(screen.getByRole('button', { name: 'Procesar (3)' })).toBeEnabled()

    releaseExists()
    expect(await screen.findByText('· 1 oculto porque ya está en la base')).toBeInTheDocument()
    expect(existsBodies).toEqual([{ ids: ['a1', 'a2', 'a3', 'a4'] }])
    expect(screen.queryByRole('link', { name: /Lugar guardado/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Seleccionar Lugar guardado')).not.toBeInTheDocument()
    // Estaba seleccionado: queda deseleccionado y no se procesa.
    expect(screen.getByRole('button', { name: 'Procesar (2)' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Aceptados/ })).toHaveTextContent('Aceptados (2)')

    // El conteo sigue al filtro de ubicación: a4 está guardado y fuera del barrio.
    await user.click(screen.getByLabelText('Mostrar sólo lugares del barrio'))
    expect(screen.getByText('· 2 ocultos porque ya están en la base')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Lugar vecino/ })).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Mostrar sólo lugares del barrio'))

    await user.click(hide)
    expect(screen.getByText('· 1 ya está en la base')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Lugar guardado/ })).toBeInTheDocument()
    await user.click(screen.getByLabelText('Seleccionar Lugar guardado'))
    await user.click(screen.getByRole('button', { name: 'Procesar (3)' }))
    await waitFor(() => expect(extractBodies.map((body) => body.googlePlaceId).sort()).toEqual(['a1', 'a2', 'a3']))
    expect(existsBodies).toHaveLength(1)

    // Volver a ocultarlos los deselecciona.
    await user.click(hide)
    expect(screen.queryByRole('link', { name: /Lugar guardado/ })).not.toBeInTheDocument()
    await user.click(hide)
    expect(screen.getByLabelText('Seleccionar Lugar guardado')).not.toBeChecked()
  })

  it('si no puede consultar la base, avisa y no oculta nada', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => String(input) === '/api/places/exists'
      ? Promise.resolve(new Response(JSON.stringify({ error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar DATABASE_URL en .env.local.' } }), { status: 503 }))
      : ndjson([{ type: 'places', items: [place] }, { type: 'done', summary: summary() }])))
    render(<App />)
    await startSweep()

    expect(await screen.findByText('· No se pudo consultar la base')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Bar Uno/ })).toBeInTheDocument()
  })

  it('separa aceptados, a revisar y rechazados, y muestra rating y reseñas sólo en las vistas previas del resumen', async () => {
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

    await user.click(screen.getByRole('button', { name: 'A revisar (1)' }))
    expect(within(screen.getAllByRole('table')[0]).getByText('primary_type_missing')).toBeInTheDocument()

    expect(screen.getByText('Rechazados (primeros 1 de 1)')).toBeInTheDocument()
    expect(screen.getByText('A revisar (primeros 1 de 1)')).toBeInTheDocument()
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

  describe('errores de Apify y cuentas compartidas', () => {
    const okResult = (id: string, name: string, extra: { selected?: string; shared?: { handle: string; places: string[] }[] } = {}) => ({
      source: 'llm', status: 'ok', model: 'anthropic/claude-sonnet-5.5',
      performance: { totalMs: 1000, stepsMs: { llm: 1000 }, costUsd: { totalUsd: 0.1, providers: { llm: { costUsd: 0.04 } } } },
      place: { googlePlaceId: id, name, categories: [], tags: [], placeFacts: [], hours: { status: 'none' }, contact: { instagram: null, website: null }, reviewReasons: [] },
      review: { unmappedFacts: [], doubts: [], anomalies: [], hoursRetry: { attempted: false, recovered: false, costUsd: 0 }, ...(extra.shared ? { instagramShared: extra.shared } : {}) },
      sourceAudit: {
        instagram: Boolean(extra.selected),
        instagramSelection: { handle: extra.selected ?? null, origin: null, candidates: extra.selected ? [{ handle: extra.selected, decision: 'selected', reason: 'validated_exact_place_profile' }] : [] },
      },
    })
    const apifyError = () => Promise.resolve(new Response(JSON.stringify({
      error: { code: 'INSTAGRAM_PROVIDER_ERROR', message: 'Error de Apify: no se pudo consultar Instagram. Instagram demoró demasiado en responder.' },
    }), { status: 502 }))
    const items = (count: number) => Array.from({ length: count }, (_, index) => ({ ...place, placeId: `a${index + 1}`, name: `Lugar ${index + 1}` }))

    function stub(sweepItems: ReturnType<typeof items>, extract: (id: string, call: number) => Promise<Response>) {
      const calls: string[] = []
      const reports: { apifyErrors?: string[]; stoppedByApify?: boolean; exaErrors?: string[]; stoppedByExa?: boolean }[] = []
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/sweep')) {
          return ndjson([
            { type: 'places', items: sweepItems },
            { type: 'done', summary: summary({ totalPlaces: sweepItems.length, byGroup: { accepted: sweepItems.length, review: 0, rejected: 0 } }) },
          ])
        }
        if (url === '/api/extraction-reports') {
          reports.push(JSON.parse(String(init?.body)))
          return Promise.resolve(new Response(JSON.stringify({ path: 'output/report.json' }), { status: 200 }))
        }
        if (url === '/api/places/exists') return Promise.resolve(new Response(JSON.stringify({ ids: [] }), { status: 200 }))
        const { googlePlaceId } = JSON.parse(String(init?.body)) as { googlePlaceId: string }
        calls.push(googlePlaceId)
        return extract(googlePlaceId, calls.filter((id) => id === googlePlaceId).length)
      }))
      return { calls, reports }
    }

    async function processAll(count: number) {
      render(<App />)
      const user = await startSweep()
      await screen.findByLabelText('Recorrido completo')
      await user.click(screen.getByLabelText('Seleccionar todos'))
      await user.click(screen.getByRole('button', { name: `Procesar (${count})` }))
      return { user, metrics: await screen.findByRole('region', { name: 'Métricas del procesamiento' }) }
    }

    it('3 errores de Apify seguidos cortan el lote: los que corrían terminan, la cola queda para reintentar y avisa', async () => {
      // Arrancan 5 (concurrencia): el 1 sale bien, 2-4 con error de Apify. Cada uno que termina libera un lugar, así que
      // el 6 y el 7 arrancan antes del tercer error y terminan igual; el 8 queda en la cola.
      const { calls, reports } = stub(items(8), (id) => ['a2', 'a3', 'a4'].includes(id)
        ? apifyError()
        : Promise.resolve(new Response(JSON.stringify(okResult(id, `Lugar ${id.slice(1)}`)), { status: 200 })))
      const { user, metrics } = await processAll(8)

      expect(screen.getByRole('alert')).toHaveTextContent('Se cortó el lote: Apify falló en 3 lugares seguidos. Revisá Apify y reintentá.')
      expect(calls.sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'])
      const instagram = within(within(metrics).getByRole('list', { name: 'Errores de Apify y Exa y cuentas compartidas' }))
      expect(instagram.getByText('Error de Apify: reintentar').nextElementSibling).toHaveTextContent('3')
      expect(instagram.getByText('Lugar 2, Lugar 3, Lugar 4')).toBeInTheDocument()
      expect(within(metrics).getByText('No se guardan: usá «Reintentar fallidos».')).toBeInTheDocument()
      // 3 de Apify y 1 que quedó en cola.
      expect(screen.getByRole('button', { name: 'Reintentar fallidos (4)' })).toBeEnabled()
      await waitFor(() => expect(reports).toHaveLength(1))
      expect(reports[0]).toMatchObject({ apifyErrors: ['a2', 'a3', 'a4'], stoppedByApify: true })

      // Los que terminaron bien se pueden guardar; los de Apify y los de la cola no.
      await user.click(screen.getByRole('button', { name: /Procesados/ }))
      expect(screen.getByRole('checkbox', { name: 'Seleccionar Lugar 1' })).toBeEnabled()
      expect(screen.getByRole('checkbox', { name: 'Seleccionar Lugar 2' })).toBeDisabled()
      expect(screen.getAllByText('Error: No se procesó: el lote se cortó por errores de Apify.')).toHaveLength(1)
    })

    it('un error de Exa no se guarda, se cuenta como «Error de Exa: reintentar» y 3 seguidos cortan el lote', async () => {
      const exaError = () => Promise.resolve(new Response(JSON.stringify({
        error: { code: 'EXA_PROVIDER_ERROR', message: 'Error de Exa: no se pudo consultar Exa. Exa no pudo completar la consulta.' },
      }), { status: 502 }))
      const { reports } = stub(items(8), (id) => ['a2', 'a3', 'a4'].includes(id)
        ? exaError()
        : Promise.resolve(new Response(JSON.stringify(okResult(id, `Lugar ${id.slice(1)}`)), { status: 200 })))
      const { user, metrics } = await processAll(8)

      expect(screen.getByRole('alert')).toHaveTextContent('Se cortó el lote: Exa falló en 3 lugares seguidos. Revisá Exa y reintentá.')
      const sources = within(within(metrics).getByRole('list', { name: 'Errores de Apify y Exa y cuentas compartidas' }))
      expect(sources.getByText('Error de Exa: reintentar').nextElementSibling).toHaveTextContent('3')
      expect(sources.getByText('Error de Apify: reintentar').nextElementSibling).toHaveTextContent('0')
      expect(sources.getByText('Lugar 2, Lugar 3, Lugar 4')).toBeInTheDocument()
      await waitFor(() => expect(reports).toHaveLength(1))
      expect(reports[0]).toMatchObject({ exaErrors: ['a2', 'a3', 'a4'], stoppedByExa: true, apifyErrors: [] })

      await user.click(screen.getByRole('button', { name: /Procesados/ }))
      expect(screen.getByRole('checkbox', { name: 'Seleccionar Lugar 2' })).toBeDisabled()
      expect(screen.getAllByText('Error: No se procesó: el lote se cortó por errores de Exa.')).toHaveLength(1)
    })

    it('errores de Apify no seguidos no cortan el lote', async () => {
      const { calls } = stub(items(4), (id) => id === 'a3'
        ? Promise.resolve(new Response(JSON.stringify(okResult(id, 'Lugar 3')), { status: 200 }))
        : apifyError())
      const { metrics } = await processAll(4)

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(calls.sort()).toEqual(['a1', 'a2', 'a3', 'a4'])
      expect(within(metrics).getByText('Lugar 1, Lugar 2, Lugar 4')).toBeInTheDocument()
    })

    it('re-procesa una vez al que se quedó con una cuenta que otro lugar del lote informó como compartida', async () => {
      const { calls } = stub([{ ...place, placeId: 'duna', name: 'Duna Bar' }, { ...place, placeId: 'marta', name: 'Doña Marta' }], (id, call) => {
        const result = id === 'duna'
          ? okResult(id, 'Duna Bar', call === 1 ? { selected: 'lanocheuy_' } : { shared: [{ handle: 'lanocheuy_', places: ['marta'] }] })
          : okResult(id, 'Doña Marta', { shared: [{ handle: 'lanocheuy_', places: ['duna'] }] })
        return Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))
      })
      const { metrics } = await processAll(2)

      expect(calls).toEqual(['duna', 'marta', 'duna'])
      const instagram = within(within(metrics).getByRole('list', { name: 'Errores de Apify y Exa y cuentas compartidas' }))
      expect(instagram.getByText('Cuentas compartidas descartadas').nextElementSibling).toHaveTextContent('1')
      expect(instagram.getByText('@lanocheuy_ (re-procesado: Duna Bar)')).toBeInTheDocument()
    })
  })

  it('los cerrados según Google quedan en A revisar sin poder seleccionarse hasta moverlos a mano, y el resumen los cuenta', async () => {
    const closed = { ...place, placeId: 'c1', name: 'Cerrado Uno', group: 'review' as const, reason: 'closed_permanently' }
    const paused = { ...place, placeId: 'c2', name: 'Cerrado Dos', group: 'review' as const, reason: 'closed_temporarily' }
    const fewReviews = { ...place, placeId: 'f1', name: 'Pocas Reseñas', group: 'review' as const, reason: 'few_reviews' }
    const extractBodies: { googlePlaceId: string }[] = []
    const result = (id: string) => ({
      source: 'llm', status: 'ok', model: 'anthropic/claude-sonnet-5.5',
      performance: { totalMs: 1000, stepsMs: { llm: 1000 }, costUsd: { totalUsd: 0.1, providers: { llm: { costUsd: 0.04 } } } },
      place: {
        googlePlaceId: id, name: id === 'c1' ? 'Cerrado Uno' : 'Pocas Reseñas', categories: [], tags: [], placeFacts: [],
        hours: { status: 'none' }, contact: { instagram: null, website: null },
        reviewReasons: id === 'c1' ? ['not_open_yet', 'no_place_facts'] : [],
      },
      review: { unmappedFacts: [], doubts: [], anomalies: [], hoursRetry: { attempted: false, recovered: false, costUsd: 0 } },
      sourceAudit: { instagram: false, instagramSelection: { handle: null, origin: null, candidates: [] } },
    })
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/sweep')) {
        return ndjson([
          { type: 'places', items: [closed, paused, fewReviews] },
          { type: 'done', summary: summary({ totalPlaces: 3, byGroup: { accepted: 0, review: 3, rejected: 0 } }) },
        ])
      }
      if (url === '/api/extraction-reports') return Promise.resolve(new Response(JSON.stringify({ path: 'output/report.json' }), { status: 200 }))
      if (url === '/api/places/exists') return Promise.resolve(new Response(JSON.stringify({ ids: [] }), { status: 200 }))
      const body = JSON.parse(String(init?.body)) as { googlePlaceId: string }
      extractBodies.push(body)
      return Promise.resolve(new Response(JSON.stringify(result(body.googlePlaceId)), { status: 200 }))
    }))
    render(<App />)
    const user = await startSweep()
    expect(await screen.findByLabelText('Recorrido completo')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'A revisar (3)' }))
    expect(screen.getByText('Cerrado definitivamente según Google')).toBeInTheDocument()
    expect(screen.getByText('Cerrado temporalmente según Google')).toBeInTheDocument()
    expect(screen.getByLabelText('Seleccionar Cerrado Uno')).toBeDisabled()
    // "Seleccionar todos" sólo toma los que se pueden procesar.
    await user.click(screen.getByLabelText('Seleccionar todos'))
    expect(screen.getByLabelText('Seleccionar Cerrado Uno')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Procesar (1)' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Permitir procesar Cerrado Uno' }))
    expect(screen.getByLabelText('Seleccionar Cerrado Uno')).toBeEnabled()
    await user.click(screen.getByLabelText('Seleccionar Cerrado Uno'))
    expect(screen.getByRole('button', { name: 'Procesar (2)' })).toBeEnabled()
    // Volver a bloquearlo lo saca de la selección.
    await user.click(screen.getByRole('button', { name: 'Volver a bloquear Cerrado Uno' }))
    expect(screen.getByRole('button', { name: 'Procesar (1)' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Permitir procesar Cerrado Uno' }))
    await user.click(screen.getByLabelText('Seleccionar Cerrado Uno'))

    await user.click(screen.getByRole('button', { name: 'Procesar (2)' }))
    const metrics = await screen.findByRole('region', { name: 'Métricas del procesamiento' })
    expect(extractBodies.map((body) => body.googlePlaceId).sort()).toEqual(['c1', 'f1'])
    const review = within(within(metrics).getByRole('list', { name: 'A revisar por motivo' }))
    expect(review.getByText('Todavía no abrió').nextElementSibling).toHaveTextContent('1')
    expect(review.getByText('Sin datos del local: las fuentes eran de otros lugares').nextElementSibling).toHaveTextContent('1')
    expect(review.getByText('Bar sin bebidas').nextElementSibling).toHaveTextContent('0')
    expect(review.getByText('Cerrado definitivamente según Google (barrido)').nextElementSibling).toHaveTextContent('1')
    expect(review.getByText('Cerrado temporalmente según Google (barrido)').nextElementSibling).toHaveTextContent('1')
    expect(review.getByText('Cerrado Dos')).toBeInTheDocument()
    expect(within(metrics).getByText('1 procesado se guarda sin publicar')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Procesados/ }))
    expect(screen.getByText('Irá a revisión: Todavía no abrió · Sin datos del local: las fuentes eran de otros lugares')).toBeInTheDocument()
  })

  it('procesa los seleccionados de Aceptados y A revisar con concurrencia 5, estados por fila, reintento y métricas', async () => {
    const accepted = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((id) => ({ ...place, placeId: id, name: `Lugar ${id}` }))
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
        ...(id === 'a3' ? { logo: { status: 'failed', reason: 'download_failed', kind: null, detail: '403' } } : {}),
        ...(id === 'r1' ? { logo: { status: 'ok', reason: null, kind: 'local' } } : {}),
        // a4 y a5 usaron el respaldo del Instagram: a4 lo rechazó la validación, a5 quedó validado.
        ...(id === 'a4' ? { logo: { status: 'missing', reason: 'no_instagram', kind: null }, instagramFallback: { attempted: true, reason: 'sin candidato', terms: ['Lugar a4'], handles: ['otro.a4'], costUsd: 0.0135 } } : {}),
        ...(id === 'a5' ? { logo: { status: 'ok', reason: null, kind: 'logo' }, instagramFallback: { attempted: true, reason: 'candidato rechazado: otro.a5, identity_or_location_mismatch', terms: ['Lugar a5'], handles: ['lugar.a5'], costUsd: 0.0135 } } : {}),
      },
      sourceAudit: {
        instagram: id === 'a5',
        instagramSelection: {
          handle: null, origin: null,
          candidates: id === 'a4' ? [{ handle: 'otro.a4', decision: 'discarded', reason: 'identity_or_location_mismatch' }] : [],
        },
      },
    })

    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/sweep')) {
        return ndjson([
          { type: 'places', items: [...accepted, review, rejected] },
          { type: 'done', summary: summary({ totalPlaces: 8, byGroup: { accepted: 6, review: 1, rejected: 1 } }) },
        ])
      }
      if (url === '/api/extraction-reports') {
        reportBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return Promise.resolve(new Response(JSON.stringify({ path: 'output/report.json' }), { status: 200 }))
      }
      if (url === '/api/places/exists') return Promise.resolve(new Response(JSON.stringify({ ids: [] }), { status: 200 }))
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
    await user.click(screen.getByRole('button', { name: /A revisar/ }))
    await user.click(screen.getByLabelText('Seleccionar Lugar r1'))
    await user.click(screen.getByRole('button', { name: /Rechazados/ }))
    expect(screen.queryByLabelText('Seleccionar todos')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Aceptados/ }))

    await user.click(screen.getByRole('button', { name: 'Procesar (7)' }))
    await waitFor(() => expect(pending).toHaveLength(5))
    const mainTable = () => screen.getAllByRole('table')[0]
    expect(within(mainTable()).getAllByText('Procesando…')).toHaveLength(5)
    expect(within(mainTable()).getAllByText('En cola')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Procesar (7)' })).toBeDisabled()

    while (pending.length > 0 || extractBodies.length < 7) {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0))
      pending.shift()?.resolve()
    }

    const metrics = await screen.findByRole('region', { name: 'Métricas del procesamiento' })
    expect(maxInFlight).toBe(5)
    expect(extractBodies).toHaveLength(7)
    expect(extractBodies.find((body) => body.googlePlaceId === 'a1')).toEqual({
      googlePlaceId: 'a1', seedCategories: ['bar', 'wine_bar'], neighborhoodId: 'PARQUE RODO',
    })
    expect(extractBodies.find((body) => body.googlePlaceId === 'r1')).toEqual({ googlePlaceId: 'r1', seedCategories: ['bar', 'wine_bar'] })
    // Al terminar el lote se manda un reporte con la revisión de los lugares listos.
    await waitFor(() => expect(reportBodies).toHaveLength(1))
    expect(reportBodies[0].places).toHaveLength(6)
    expect((reportBodies[0].places as { googlePlaceId: string; review: unknown }[]).find((entry) => entry.googlePlaceId === 'a1')).toEqual({
      name: 'Lugar a1', googlePlaceId: 'a1', reviewReasons: [],
      stats: {
        hoursStatus: 'none', hasInstagram: false, hasWebsite: true, tagCount: 2, costUsd: 0.1, totalMs: 4000,
        sourcesUsd: expect.closeTo(0.03, 6), mainLlmUsd: 0.04, hoursRetryUsd: 0.03, logoUsd: 0, inputTokens: 10_000, cachedInputTokens: 3_000, cacheWriteTokens: 0,
      },
      review: {
        unmappedFacts: [{ id: 'F1', text: 'Karaoke en a1', proposedTag: 'karaoke' }], doubts: [],
        anomalies: [{ type: 'no_contact', detail: 'sin instagram ni website' }], hoursRetry: { attempted: true, recovered: false, costUsd: 0.03 },
      },
    })
    expect(within(metrics).getByText('Listos').nextElementSibling).toHaveTextContent('6')
    expect(within(metrics).getByText('Con error').nextElementSibling).toHaveTextContent('1')
    expect(within(metrics).getByText('Google').nextElementSibling).toHaveTextContent('1,0 s')
    expect(within(metrics).getByText('LLM').nextElementSibling).toHaveTextContent('3,0 s')
    // Logos: conteo por motivo y, debajo, los lugares con el código HTTP o la clasificación.
    const logos = within(within(metrics).getByRole('list', { name: 'Logos por resultado' }))
    expect(logos.getByText('Error al bajar la imagen').nextElementSibling).toHaveTextContent('1')
    expect(logos.getByText('Lugar a3 (403)')).toBeInTheDocument()
    expect(logos.getByText('Clasificada como local, comida u otro').nextElementSibling).toHaveTextContent('1')
    expect(logos.getByText('Lugar r1 (Local)')).toBeInTheDocument()
    expect(logos.getByText('Con logo').nextElementSibling).toHaveTextContent('1')
    expect(logos.getByText('Instagram rechazado en la validación').nextElementSibling).toHaveTextContent('1')
    expect(logos.getByText('Lugar a4 (@otro.a4: identity_or_location_mismatch (respaldo))')).toBeInTheDocument()
    const fallbackLine = within(metrics).getByText('Instagram encontrado por el respaldo')
    expect(fallbackLine.nextElementSibling).toHaveTextContent('1 de 2 búsquedas')
    expect(fallbackLine.closest('p')).toHaveTextContent('Lugar a5 (tras rechazo)')
    expect(within(metrics).getByText('1 con error, sin paso de logo')).toBeInTheDocument()
    expect(within(mainTable()).getByText('Error: Falló a2')).toBeInTheDocument()
    expect(within(mainTable()).getAllByText(/^Listo · /)).toHaveLength(5)

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
    await waitFor(() => expect(within(mainTable()).getAllByText(/^Listo · /)).toHaveLength(6))
    expect(extractBodies).toHaveLength(8)
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
