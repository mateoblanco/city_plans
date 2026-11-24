import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoogleFlagItem, GoogleFlagsResponse } from '@/types/google-flags'
import { GoogleFlagsPanel } from './google-flags-panel'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const failure = (message: string) => json({ error: { code: 'UNKNOWN_ERROR', message } }, 500)

const flag = (overrides: Partial<GoogleFlagItem>): GoogleFlagItem => ({
  id: 'f1', placeId: 'p1', placeName: 'El Palenque', reason: 'moved', detectedAt: '2026-11-24T07:00:00.000Z',
  distanceM: 180, newGooglePlaceId: null, ...overrides,
})
const response = (overrides: Partial<GoogleFlagsResponse> = {}): GoogleFlagsResponse => ({
  flags: [flag({}), flag({ id: 'f2', placeId: 'p2', placeName: 'Bar Facal', reason: 'not_found', distanceM: null })],
  stale: 12,
  lastRun: { startedAt: '2026-11-24T07:00:00.000Z', refreshed: 38, flagged: 2, failed: 0, stoppedReason: 'quota' },
  ...overrides,
})

/** Servidor de mentira: GET con la respuesta dada (o falla las primeras `listFailures` veces), y las dos acciones. */
function fakeServer(data: GoogleFlagsResponse, fail: { list?: number; ignore?: boolean; unpublish?: boolean } = {}) {
  let listFailures = fail.list ?? 0
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/api/google-flags') {
      if (listFailures-- > 0) return failure('No se pudieron leer los avisos de Google.')
      return json(data)
    }
    if (input.endsWith('/ignored')) return fail.ignore ? failure('No se pudo ignorar el aviso.') : json({ id: 'x', ignored: true })
    if (input.endsWith('/unpublish') && init?.method === 'POST') return fail.unpublish ? failure('No se pudo despublicar el lugar.') : json({ id: 'x', outcome: 'unpublished' })
    throw new Error(`pedido inesperado: ${input}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const summary = () => document.getElementById('google-flags-summary')?.textContent ?? ''

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GoogleFlagsPanel', () => {
  it('mientras carga muestra "Cargando…" y después el control: atrasados y la última corrida', async () => {
    fakeServer(response())
    render(<GoogleFlagsPanel onUnpublished={vi.fn()} />)
    expect(summary()).toBe('Cargando…')
    expect(await screen.findByText('12 lugares con coordenadas de más de 30 días')).toBeTruthy()
    expect(summary()).toContain('refrescó 38, marcó 2, fallaron 0 (cortada por cuota (429))')
    expect(screen.getByRole('heading', { name: 'Avisos de Google (2)' })).toBeTruthy()
  })

  it('sin avisos ni corridas: al día y sin botón para ver la lista', async () => {
    fakeServer(response({ flags: [], stale: 0, lastRun: null }))
    render(<GoogleFlagsPanel onUnpublished={vi.fn()} />)
    expect(await screen.findByText('Todas las coordenadas tienen menos de 30 días')).toBeTruthy()
    expect(summary()).toContain('Todavía no corrió el refresco')
    expect(screen.queryByRole('button', { name: /Ver avisos/ })).toBeNull()
  })

  it('error inicial con Reintentar', async () => {
    fakeServer(response(), { list: 1 })
    render(<GoogleFlagsPanel onUnpublished={vi.fn()} />)
    expect(await screen.findByText('No se pudieron leer los avisos de Google.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Avisos de Google (2)' })).toBeTruthy()
  })

  it('muestra cada aviso con motivo, detalle y fecha', async () => {
    fakeServer(response())
    render(<GoogleFlagsPanel onUnpublished={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Ver avisos/ }))
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('El Palenque')
    expect(rows[0].textContent).toContain('Se movió')
    expect(rows[0].textContent).toContain('180 m')
    expect(rows[1].textContent).toContain('No encontrado en Google')
  })

  it('Ignorar saca el aviso; si falla vuelve con el error en su fila y el resto sigue', async () => {
    const fetchMock = fakeServer(response(), { ignore: true })
    render(<GoogleFlagsPanel onUnpublished={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Ver avisos/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Ignorar el aviso de El Palenque' }))
    expect((await screen.findByRole('alert')).textContent).toBe('No se pudo ignorar el aviso.')
    expect(screen.getByRole('button', { name: 'Ignorar el aviso de Bar Facal' })).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/google-flags/f1/ignored', expect.objectContaining({ method: 'PATCH', body: '{"ignored":true}' }))
  })

  it('Ignorar con éxito deja sólo los demás', async () => {
    fakeServer(response())
    render(<GoogleFlagsPanel onUnpublished={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: /Ver avisos/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Ignorar el aviso de El Palenque' }))
    await waitFor(() => expect(screen.queryByText('El Palenque')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Avisos de Google (1)' })).toBeTruthy()
  })

  it('Despublicar pide confirmación con el motivo y avisa a la página', async () => {
    const onUnpublished = vi.fn()
    const fetchMock = fakeServer(response())
    render(<GoogleFlagsPanel onUnpublished={onUnpublished} />)
    await userEvent.click(await screen.findByRole('button', { name: /Ver avisos/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Despublicar El Palenque' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('«Se movió según Google»')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/google-flags/f1/unpublish', expect.anything())
    await userEvent.click(within(dialog).getByRole('button', { name: 'Despublicar' }))
    await waitFor(() => expect(onUnpublished).toHaveBeenCalledWith('El Palenque'))
    expect(screen.queryByText('El Palenque')).toBeNull()
  })

  it('si Despublicar falla, el error queda en el diálogo y el aviso sigue', async () => {
    const onUnpublished = vi.fn()
    fakeServer(response(), { unpublish: true })
    render(<GoogleFlagsPanel onUnpublished={onUnpublished} />)
    await userEvent.click(await screen.findByRole('button', { name: /Ver avisos/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Despublicar Bar Facal' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('«No encontrado en Google»')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Despublicar' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('No se pudo despublicar el lugar.')
    expect(onUnpublished).not.toHaveBeenCalled()
  })
})
