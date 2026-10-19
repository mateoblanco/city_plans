import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SavePlaceButton } from '@/components/save-place-button'
import type { PlaceEnrichmentResponse } from '@/types/places'

const jsonResponse = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const result = { source: 'llm', status: 'ok', place: { googlePlaceId: 'place-1', name: 'El Palenque' } } as unknown as PlaceEnrichmentResponse

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SavePlaceButton', () => {
  it('ofrece Actualizar si el lugar ya está y muestra el resultado del guardado', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => String(input).startsWith('/api/places/exists')
      ? jsonResponse({ ids: ['place-1'] })
      : jsonResponse({ results: [{ googlePlaceId: 'place-1', id: 'uuid-1', action: 'updated', embedded: false }] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SavePlaceButton result={result} />)

    const button = await screen.findByRole('button', { name: 'Actualizar' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/places/exists')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ ids: ['place-1'] }) })
    await userEvent.click(button)

    expect(await screen.findByText('Actualizado ✓')).toBeInTheDocument()
    expect(screen.getByText('sin embedding')).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ results: [result] })
  })

  it('guarda un lugar nuevo y muestra el error del server si no se pudo', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => String(input).startsWith('/api/places/exists')
      ? jsonResponse({ ids: [] })
      : jsonResponse({ results: [{ googlePlaceId: 'place-1', id: null, action: 'skipped', embedded: false, error: 'Sin barrio' }] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SavePlaceButton result={result} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Sin barrio')).toBeInTheDocument()
    expect(screen.queryByText('Guardado ✓')).not.toBeInTheDocument()
  })

  it('queda deshabilitado sin resultado', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(<SavePlaceButton result={null} />)

    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no deja guardar un lugar sin nombre confirmado por las fuentes', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ ids: [] })))
    const unnamed = { ...result, place: { googlePlaceId: 'place-1', name: '' } } as unknown as PlaceEnrichmentResponse
    render(<SavePlaceButton result={unnamed} />)

    expect(screen.getByText('No se puede guardar: ninguna fuente confirma el nombre.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Guardar' })).toBeDisabled()
  })
})
