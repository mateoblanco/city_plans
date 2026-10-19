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
  prominence: 0.125, igFollowers: null, featured: false,
  logoUrl: null, logoKind: null, logoBgColor: null, logoColor: null, iconCategory: 'grill', reviewReasons: [], ...overrides,
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

  it('muestra el ícono de la categoría, la miniatura del logo, su clasificación y los dos colores', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ places: [
      place({ logoUrl: 'https://logos.example/logos/p-0a1b2c3d.webp', logoKind: 'logo', logoBgColor: '#ffffff', logoColor: '#1e6fd9' }),
      place({ id: 'uuid-2', name: 'Café Sin Logo', iconCategory: 'coffee' }),
      place({ id: 'uuid-3', name: 'Sin Categoría', iconCategory: null }),
    ] })))
    render(<SavedPlacesPage />)

    await screen.findByText('3 lugares')
    const [, first, second, third] = screen.getAllByRole('row')
    expect(within(first).getByRole('img', { name: 'Logo de El Palenque' }).getAttribute('src')).toBe('https://logos.example/logos/p-0a1b2c3d.webp')
    expect(within(first).getByRole('img', { name: 'grill' }).textContent).toBe('🥩')
    expect(within(first).getByTitle('grill')).toBeTruthy()
    expect(within(second).getByRole('img', { name: 'coffee' }).textContent).toBe('☕')
    expect(within(third).getByRole('img', { name: 'Sin categoría' }).textContent).toBe('🍽️')
    expect(within(third).getByTitle('Sin categoría')).toBeTruthy()
    expect(within(first).getByText('Logo')).toBeTruthy()
    expect(within(first).getByTitle('Fondo: #ffffff')).toBeTruthy()
    expect(within(first).getByTitle('Principal: #1e6fd9')).toBeTruthy()
    expect(within(second).getByText('Sin logo')).toBeTruthy()
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

  it('muestra la prominencia y los seguidores', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ places: [place({ prominence: 0.5432, igFollowers: 12345 })] })))
    render(<SavedPlacesPage />)

    await screen.findByText('1 lugar')
    const [, row] = screen.getAllByRole('row')
    expect(within(row).getByText('0.54')).toBeTruthy()
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

  it('la tab A revisar muestra sólo los que están en review, con sus motivos', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ places: [
      place({}),
      place({ id: 'uuid-2', name: 'VÜS Café', status: 'review', reviewReasons: ['not_open_yet'] }),
      place({ id: 'uuid-3', name: 'Ébano', status: 'review', reviewReasons: ['no_place_facts', 'restaurant_without_food'] }),
    ] })))
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    expect(await screen.findByRole('button', { name: 'Todos (3)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Motivos')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'A revisar (2)' }))

    expect(screen.getByRole('status')).toHaveTextContent('2 lugares')
    expect(screen.queryByText('El Palenque')).toBeNull()
    expect(screen.getByText('Todavía no abrió')).toBeInTheDocument()
    expect(screen.getByText('Sin datos del local: las fuentes eran de otros lugares · Restaurante sin comidas')).toBeInTheDocument()
    expect(screen.getAllByText('A revisar', { selector: 'td' })).toHaveLength(2)
  })

  it('A revisar vacío', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ places: [place({})] })))
    render(<SavedPlacesPage />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'A revisar (0)' }))

    expect(screen.getByText('No hay lugares para revisar')).toBeInTheDocument()
  })

  it('publica a mano: sale de A revisar y queda publicado', async () => {
    const fetchMock = vi.fn((url: string) => url === '/api/places'
      ? jsonResponse({ places: [place({ status: 'review', reviewReasons: ['bar_without_drinks'] })] })
      : jsonResponse({ id: 'uuid-1', status: 'published' }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'A revisar (1)' }))
    await user.click(screen.getByRole('button', { name: 'Publicar El Palenque' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/places/uuid-1/status', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'published' }) }))
    expect(await screen.findByText('No hay lugares para revisar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Todos (1)' }))
    expect(screen.getByText('Publicado', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('si no se pudo publicar, vuelve a A revisar con el error', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/places'
      ? jsonResponse({ places: [place({ status: 'review', reviewReasons: ['not_open_yet'] })] })
      : jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo publicar el lugar.' } }, 500)))
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'A revisar (1)' }))
    await user.click(screen.getByRole('button', { name: 'Publicar El Palenque' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo publicar el lugar.')
    expect(screen.getByRole('button', { name: 'Publicar El Palenque' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'A revisar (1)' })).toBeInTheDocument()
  })
})
