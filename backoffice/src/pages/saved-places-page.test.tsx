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
  status: 'published', hoursStatus: 'exact', updatedAt: '2026-10-12T15:30:00.000Z', hasEmbedding: true,
  prominence: 0.125, editorialMentions: 0, listedOrAwarded: false, igFollowers: null, featured: false, ...overrides,
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

  it('muestra las señales de prominencia', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ places: [place({ prominence: 0.5432, editorialMentions: 3, listedOrAwarded: true, igFollowers: 12345 })] })))
    render(<SavedPlacesPage />)

    await screen.findByText('1 lugar')
    const [, row] = screen.getAllByRole('row')
    expect(within(row).getByText('0.54')).toBeTruthy()
    expect(within(row).getByText('3')).toBeTruthy()
    expect(within(row).getByLabelText('En lista o premiado')).toBeTruthy()
    expect(within(row).getByText('12.345')).toBeTruthy()
  })

  it('ordena por prominencia y vuelve al más reciente', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ places: [
      place({ id: 'a', name: 'Reciente', prominence: 0.2, updatedAt: '2026-10-12T15:30:00.000Z' }),
      place({ id: 'b', name: 'Prominente', prominence: 0.9, updatedAt: '2026-10-01T15:30:00.000Z' }),
    ] })))
    render(<SavedPlacesPage />)
    await screen.findByText('2 lugares')
    const names = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
    const user = userEvent.setup()

    expect(names()).toEqual(['Reciente', 'Prominente'])
    await user.click(screen.getByRole('button', { name: /Prominencia/ }))
    expect(names()).toEqual(['Prominente', 'Reciente'])
    expect(screen.getByRole('columnheader', { name: /Prominencia/ }).getAttribute('aria-sort')).toBe('descending')
    await user.click(screen.getByRole('button', { name: /Prominencia/ }))
    expect(names()).toEqual(['Reciente', 'Prominente'])
  })

  it('guarda el destacado directo', async () => {
    const fetchMock = vi.fn((url: string) => url === '/api/places'
      ? jsonResponse({ places: [place({})] })
      : jsonResponse({ id: 'uuid-1', featured: true }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SavedPlacesPage />)

    const checkbox = await screen.findByLabelText('Destacar El Palenque') as HTMLInputElement
    await userEvent.setup().click(checkbox)

    expect(checkbox.checked).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/places/uuid-1/featured', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ featured: true }) }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('revierte el destacado y muestra el error si no se pudo guardar', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/places'
      ? jsonResponse({ places: [place({ featured: true })] })
      : jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo guardar el destacado.' } }, 500)))
    render(<SavedPlacesPage />)

    const checkbox = await screen.findByLabelText('Destacar El Palenque') as HTMLInputElement
    await userEvent.setup().click(checkbox)

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo guardar el destacado.')
    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(false)
  })
})
