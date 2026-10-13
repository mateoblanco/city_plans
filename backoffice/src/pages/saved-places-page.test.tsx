import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaceListItem } from '@/types/places'
import { SavedPlacesPage } from './saved-places-page'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const place = (overrides: Partial<PlaceListItem>): PlaceListItem => ({
  id: 'uuid-1', name: 'El Palenque', neighborhoodId: 'CIUDAD VIEJA', categories: ['restaurant'], tags: ['cash_only', 'kids_friendly'],
  status: 'published', hoursStatus: 'exact', updatedAt: '2026-10-12T15:30:00.000Z', hasEmbedding: true, ...overrides,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SavedPlacesPage', () => {
  it('muestra el total y una fila por lugar', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ places: [
      place({}),
      place({ id: 'uuid-2', name: 'Café Sin Nada', categories: [], tags: [], status: 'draft', hoursStatus: 'none', hasEmbedding: false }),
    ] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SavedPlacesPage />)

    expect(await screen.findByText('2 lugares')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/places', expect.anything())
    const [, first, second] = screen.getAllByRole('row')
    expect(within(first).getByText('El Palenque')).toBeTruthy()
    expect(within(first).getByText('CIUDAD VIEJA')).toBeTruthy()
    expect(within(first).getByText('Restaurante')).toBeTruthy()
    expect(within(first).getByText('2')).toBeTruthy()
    expect(within(first).getByText('Publicado')).toBeTruthy()
    expect(within(first).getByText('Exacto')).toBeTruthy()
    expect(within(first).getByLabelText('Con embedding')).toBeTruthy()
    // Fecha y hora local; el formato exacto depende de la zona horaria del entorno.
    expect(within(first).getByText(/^12\/10\/(20)?26,? \d{1,2}:30/)).toBeTruthy()
    expect(within(second).getByText('Borrador')).toBeTruthy()
    expect(within(second).getByText('Sin horario')).toBeTruthy()
    expect(within(second).getByLabelText('Sin embedding')).toBeTruthy()
  })

  it('muestra el estado vacío', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ places: [] })))
    render(<SavedPlacesPage />)

    expect(await screen.findByText('Todavía no hay lugares guardados')).toBeTruthy()
    expect(screen.getByText('0 lugares')).toBeTruthy()
  })

  it('muestra el error y permite reintentar', async () => {
    const fetchMock = vi.fn()
      .mockReturnValueOnce(jsonResponse({ error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar DATABASE_URL en .env.local.' } }, 503))
      .mockReturnValueOnce(jsonResponse({ places: [place({})] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SavedPlacesPage />)

    expect(await screen.findByText('Falta configurar DATABASE_URL en .env.local.')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('1 lugar')).toBeTruthy()
  })
})
