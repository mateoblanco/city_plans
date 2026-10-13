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
    expect(fetchMock.mock.calls[0][0]).toBe('/api/places/exists?ids=place-1,place-2,place-3,place-4')
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
