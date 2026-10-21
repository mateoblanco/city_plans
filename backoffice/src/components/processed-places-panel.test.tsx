import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProcessedPlacesPanel } from '@/components/processed-places-panel'
import { buildProcessedSummary } from '@/lib/processed-summary'
import type { ExtractionRow } from '@/hooks/use-extraction-batch'
import type { PlaceEnrichmentResponse } from '@/types/places'

const jsonResponse = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const ok = (id: string, name: string, hours: 'exact' | 'none', review: { anomalies?: { type: string; detail: string }[]; doubts?: string[] } = {}) => ({
  source: 'llm', status: 'ok',
  place: { googlePlaceId: id, name, categories: ['bar'], hours: { status: hours } },
  review: { anomalies: review.anomalies ?? [], doubts: review.doubts ?? [] },
}) as unknown as PlaceEnrichmentResponse

const rows: Record<string, ExtractionRow> = {
  'place-1': { status: 'done', result: ok('place-1', 'Bar Uno', 'exact', {
    anomalies: [{ type: 'cuisine_unmentioned', detail: 'mexican' }],
    doubts: ['¿Es bar o restaurante?'],
  }) },
  'place-2': { status: 'done', result: ok('place-2', 'Bar Dos', 'none', {
    anomalies: [{ type: 'hours_vague', detail: 'sin cierre' }, { type: 'cuisine_unmentioned', detail: 'italian' }],
  }) },
  'place-3': { status: 'done', result: { source: 'llm', status: 'no_sources', target: { name: 'Sin Fuentes', googlePlaceId: 'place-3' } } as unknown as PlaceEnrichmentResponse },
  'place-4': { status: 'error', error: 'Falló el pipeline' },
  'place-5': { status: 'running' },
}
const places = [{ placeId: 'place-4', name: 'Bar Roto' }]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(saveResponse: () => Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) =>
    String(input).startsWith('/api/places/exists') ? jsonResponse({ ids: ['place-2'] }) : saveResponse())
  vi.stubGlobal('fetch', fetchMock)
  render(<ProcessedPlacesPanel rows={rows} places={places} categoryLabel={(id) => id === 'bar' ? 'Bar' : id} />)
  const row = (name: string) => screen.getByRole('row', { name: new RegExp(name) })
  return { fetchMock, row }
}

describe('ProcessedPlacesPanel', () => {
  it('muestra el ícono de la categoría, el logo con su clasificación y colores, o por qué no hay', () => {
    const withLogo = {
      ...ok('place-1', 'Bar Uno', 'exact'),
      logoUrl: 'https://logos.example/logos/place-1-0a1b2c3d.webp',
    } as PlaceEnrichmentResponse & { status: 'ok' }
    withLogo.place.logo = { key: 'logos/place-1-0a1b2c3d.webp', kind: 'local', bgColor: null, color: '#c0392b', source: 'instagram', fetchedAt: '2026-10-16T12:00:00.000Z' }
    withLogo.review.logo = { status: 'ok', reason: null, kind: 'local' }
    withLogo.place.iconCategory = 'croissant'
    const failed = ok('place-2', 'Bar Dos', 'exact') as PlaceEnrichmentResponse & { status: 'ok' }
    failed.review.logo = { status: 'failed', reason: 'upload_failed', kind: 'logo' }
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ids: [] })))
    render(<ProcessedPlacesPanel rows={{ 'place-1': { status: 'done', result: withLogo }, 'place-2': { status: 'done', result: failed } }} places={[]} categoryLabel={(id) => id} />)

    const uno = screen.getByRole('row', { name: /Bar Uno/ })
    expect(within(uno).getByRole('img', { name: 'Logo de Bar Uno' })).toHaveAttribute('src', 'https://logos.example/logos/place-1-0a1b2c3d.webp')
    expect(within(uno).getByRole('img', { name: 'croissant' })).toHaveTextContent('🥐')
    expect(within(uno).getByTitle('croissant')).toBeInTheDocument()
    expect(within(uno).getByText('Local')).toBeInTheDocument()
    expect(within(uno).getByTitle('Fondo: sin dato')).toBeInTheDocument()
    expect(within(uno).getByText('#c0392b')).toBeInTheDocument()
    const dos = screen.getByRole('row', { name: /Bar Dos/ })
    expect(within(dos).getByText('Sin logo')).toBeInTheDocument()
    // Sin categoría (un resultado de antes): el ícono de reserva, sólo visual.
    expect(within(dos).getByRole('img', { name: 'Sin categoría' })).toHaveTextContent('🍽️')
    expect(within(dos).getByText('no se pudo subir a R2')).toBeInTheDocument()
  })

  it('anota los 429 que hubo en cada lugar y si se recuperó', () => {
    const limited = ok('place-1', 'Bar Uno', 'exact') as PlaceEnrichmentResponse & { status: 'ok' }
    limited.review.rateLimits = [{ service: 'exa', retries: 3, waitedMs: 7000, recovered: false }, { service: 'llm', retries: 1, waitedMs: 1000, recovered: true }]
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ids: [] })))
    render(<ProcessedPlacesPanel rows={{ 'place-1': { status: 'done', result: limited }, 'place-2': { status: 'done', result: ok('place-2', 'Bar Dos', 'exact') } }} places={[]} categoryLabel={(id) => id} />)

    expect(within(screen.getByRole('row', { name: /Bar Uno/ })).getByText('Reintentos: Exa ×3 sin recuperar · LLM ×1 recuperado')).toBeInTheDocument()
    expect(within(screen.getByRole('row', { name: /Bar Dos/ })).queryByText(/Reintentos/)).not.toBeInTheDocument()
  })

  it('anota los reintentos de Apify por timeout y el desempate del Instagram', () => {
    const tied = ok('place-1', 'Cordón Beer', 'exact') as PlaceEnrichmentResponse & { status: 'ok' }
    tied.review.rateLimits = [{ service: 'apify', retries: 0, transientRetries: 2, waitedMs: 20000, recovered: true }]
    tied.review.instagramTieBreak = { rule: 'latest_post', handles: ['cordonbeer', 'cordon.beer'] }
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ids: [] })))
    render(<ProcessedPlacesPanel rows={{ 'place-1': { status: 'done', result: tied } }} places={[]} categoryLabel={(id) => id} />)

    const row = screen.getByRole('row', { name: /Cordón Beer/ })
    expect(within(row).getByText('Reintentos: Apify ×2 por timeout recuperado')).toBeInTheDocument()
    expect(within(row).getByText('Desempate de Instagram: post más reciente (@cordonbeer vs @cordon.beer)')).toBeInTheDocument()
  })

  it('lista lo procesado, tilda los ok y consulta qué ya está en la base', async () => {
    const { fetchMock, row } = setup(() => jsonResponse({ results: [] }))

    expect(screen.getAllByRole('row')).toHaveLength(5)
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Bar Uno' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Bar Dos' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Sin Fuentes' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Bar Roto' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Guardar Bar Roto' })).toBeDisabled()
    expect(within(row('Bar Uno')).getByText('Bar')).toBeInTheDocument()
    expect(within(row('Bar Uno')).getByText('Exacto')).toBeInTheDocument()
    expect(await within(row('Bar Uno')).findByText('nuevo')).toBeInTheDocument()
    expect(within(row('Bar Dos')).getByText('ya existe')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/places/exists')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ ids: ['place-1', 'place-2', 'place-3', 'place-4'] })
    expect(screen.getByRole('button', { name: /Guardar seleccionados \(2\)/ })).toBeEnabled()
  })

  it('guarda los seleccionados en un solo POST y actualiza la columna y el resumen', async () => {
    const { fetchMock, row } = setup(() => jsonResponse({ results: [
      { googlePlaceId: 'place-1', id: 'uuid-1', action: 'created', embedded: true },
      { googlePlaceId: 'place-2', id: 'uuid-2', action: 'updated', embedded: false },
      { googlePlaceId: 'place-3', id: null, action: 'skipped', embedded: false, error: 'Sin fuentes: no hay datos para guardar' },
    ] }))
    await screen.findByText('ya existe')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar Sin Fuentes' }))
    await userEvent.click(screen.getByRole('button', { name: /Guardar seleccionados \(3\)/ }))

    expect(await screen.findByText('1 creados, 1 actualizados, 1 sin embedding, 1 errores')).toBeInTheDocument()
    const posts = fetchMock.mock.calls.filter(([input]) => input === '/api/places')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(String(posts[0][1]?.body)).results.map((result: { status: string }) => result.status)).toEqual(['ok', 'ok', 'no_sources'])
    expect(within(row('Bar Uno')).getByText('guardado')).toBeInTheDocument()
    expect(within(row('Bar Dos')).getByText('actualizado')).toBeInTheDocument()
    expect(within(row('Bar Dos')).getByText('sin embedding')).toBeInTheDocument()
    expect(within(row('Sin Fuentes')).getByText('error')).toBeInTheDocument()
  })

  it('guarda una sola fila y marca error si falla la request', async () => {
    const { fetchMock, row } = setup(() => jsonResponse({ error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar DATABASE_URL en .env.local.' } }, 503))
    await screen.findByText('ya existe')

    await userEvent.click(screen.getByRole('button', { name: 'Guardar Bar Uno' }))

    await waitFor(() => expect(within(row('Bar Uno')).getByText('error')).toBeInTheDocument())
    const posts = fetchMock.mock.calls.filter(([input]) => input === '/api/places')
    expect(JSON.parse(String(posts[0][1]?.body)).results).toHaveLength(1)
    expect(screen.getByText('0 creados, 0 actualizados, 0 sin embedding, 1 errores')).toBeInTheDocument()
    expect(within(row('Bar Dos')).getByText('ya existe')).toBeInTheDocument()
  })

  it('una fila sin nombre confirmado no se puede guardar y muestra el error', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ ids: [] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ProcessedPlacesPanel
      rows={{ 'place-1': { status: 'done', result: ok('place-1', 'Bar Uno', 'exact') }, 'place-9': { status: 'done', result: ok('place-9', '', 'exact') } }}
      places={[{ placeId: 'place-9', name: 'Nombre De Google' }]}
      categoryLabel={(id) => id}
    />)

    const unnamed = screen.getByRole('row', { name: /Nombre De Google/ })
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Nombre De Google' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Seleccionar Nombre De Google' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Guardar Nombre De Google' })).toBeDisabled()
    expect(within(unnamed).getByText('error')).toBeInTheDocument()
    expect(within(unnamed).getByText('Sin nombre confirmado: no se puede guardar')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Guardar seleccionados \(1\)/ })).toBeEnabled()
  })

  it('copia al portapapeles el resumen del lote', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    setup(() => jsonResponse({ results: [] }))

    await userEvent.click(screen.getByRole('button', { name: 'Copiar resumen' }))

    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument()
    expect(JSON.parse(String(writeText.mock.calls[0]?.[0]))).toEqual({
      procesados: 4,
      conError: 1,
      anomalias: { cuisine_unmentioned: 2, hours_vague: 1 },
      dudas: [{ lugar: 'Bar Uno', dudas: ['¿Es bar o restaurante?'] }],
      aRevisar: {},
    })
  })
})

describe('buildProcessedSummary', () => {
  it('ignora lo que sigue corriendo y ordena las anomalías por cantidad', () => {
    const summary = buildProcessedSummary(
      Object.entries(rows).filter(([, row]) => row.status === 'done' || row.status === 'error'),
      (id) => id,
    )
    expect(summary.procesados).toBe(4)
    expect(Object.keys(summary.anomalias)).toEqual(['cuisine_unmentioned', 'hours_vague'])
    expect(summary.dudas).toEqual([{ lugar: 'place-1', dudas: ['¿Es bar o restaurante?'] }])
  })
})
