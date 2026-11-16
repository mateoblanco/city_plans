import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PopularityRow } from '@/types/popularity'
import { PopularityPage } from './popularity-page'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const row = (name: string, patch: Partial<PopularityRow> = {}): PopularityRow => ({
  id: name, name, slug: name, views7: 0, views30: 0, saves7: 0, saves30: 0, directions7: 0, directions30: 0, origins: {}, homeRows: [], ...patch,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const names = () => screen.getAllByRole('row').slice(1).map((tr) => within(tr).getAllByRole('cell')[0].textContent)

describe('PopularityPage', () => {
  it('cargando y después la tabla, ordenada por vistas de 30 días; se ordena tocando el encabezado', async () => {
    let resolve!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r })))
    render(<PopularityPage />)
    expect(screen.getByLabelText('Cargando popularidad')).toBeInTheDocument()

    resolve(await json({
      today: '2026-11-15',
      rows: [
        row('Bar Dos', { views30: 4, saves7: 3, origins: { search: 3, direct: 1 } }),
        row('Café Uno', { views30: 10, saves7: 1, origins: { home: 8, search: 2 }, homeRows: [{ row: 'breakfast', count: 8 }] }),
      ],
    }))
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(names()).toEqual(['Café Uno', 'Bar Dos'])
    expect(screen.getByText(/Home 80% · Búsqueda 20%/)).toBeInTheDocument()
    expect(screen.getByText('Filas: breakfast (8)')).toBeInTheDocument()

    const header = screen.getByRole('button', { name: /Guardados 7 d/ })
    await userEvent.click(header)
    expect(names()).toEqual(['Bar Dos', 'Café Uno'])
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'descending')
    await userEvent.click(header)
    expect(names()).toEqual(['Café Uno', 'Bar Dos'])
    expect(header.closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sin datos: el aviso de vacío', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ today: '2026-11-15', rows: [] })))
    render(<PopularityPage />)
    expect(await screen.findByText(/Todavía no hay datos/)).toBeInTheDocument()
  })

  it('error al cargar y reintentar', async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json({ error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar DATABASE_URL en .env.local.' } }, 503))
      .mockImplementationOnce(() => json({ today: '2026-11-15', rows: [row('Café Uno', { views30: 1 })] }))
    vi.stubGlobal('fetch', fetchMock)
    render(<PopularityPage />)
    expect(await screen.findByText('No se pudo cargar la popularidad')).toBeInTheDocument()
    expect(screen.getByText('Falta configurar DATABASE_URL en .env.local.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
