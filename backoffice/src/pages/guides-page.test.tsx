import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuideDetail, GuideSummary } from '@/types/guides'
import { GuidesPage } from './guides-page'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

const summary = (patch: Partial<GuideSummary>): GuideSummary => ({
  id: 'g1', slug: 'cafes', city: 'montevideo', neighborhoodId: 'CORDON', group: 'cafes', title: 'Cafés donde nadie te apura', status: 'published',
  featured: false, placeCount: 9, publishedAt: '2026-11-19T12:00:00Z', contentUpdatedAt: '2026-11-19T12:00:00Z', warnings: [], ...patch,
})

const place = (n: number, status = 'published') => ({ placeId: `00000000-0000-4000-8000-00000000000${n}`, text: `Texto ${n}`, name: `Lugar ${n}`, slug: `lugar-${n}`, neighborhoodId: 'CORDON', status })

const detail = (patch: Partial<GuideDetail> = {}): GuideDetail => ({
  id: 'g1', slug: 'cafes-donde-nadie-te-apura', city: 'montevideo', neighborhoodId: 'CORDON', group: 'cafes', title: 'Cafés', seoTitle: 'Cafés en Cordón',
  seoDescription: 'Cafés.', intro: 'Intro.', status: 'draft', featured: false, color: '#FF8E00', publishedAt: null, contentUpdatedAt: '2026-11-19T12:00:00Z', aiCostUsd: 0,
  places: [1, 2, 3].map((n) => place(n)), ...patch,
})

type Route = (url: string, init?: RequestInit) => Promise<Response> | undefined

function stubApi(route: Route) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => route(String(input), init) ?? json({ error: { code: 'X', message: `sin ruta ${String(input)}` } }, 404))
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GuidesPage › listado', () => {
  it('muestra las guías con sus avisos; los filtros van al servidor', async () => {
    const fetch = stubApi((url) =>
      url.startsWith('/api/guides')
        ? json({
            guides: [summary({ warnings: [{ code: 'unpublished_places', places: ['Sauco'] }, { code: 'stale', months: 7 }] }), summary({ id: 'g2', title: 'Sushi', neighborhoodId: null, status: 'draft', group: 'eat' })],
            neighborhoods: ['CORDON'],
          })
        : undefined,
    )
    render(<GuidesPage />)
    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(screen.getByText('Lugar despublicado: Sauco')).toBeInTheDocument()
    expect(screen.getByText('7 meses sin actualizar')).toBeInTheDocument()
    expect(screen.getByText('Montevideo · Toda la ciudad')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getByText('Borrador')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Estado'), 'published')
    await userEvent.selectOptions(screen.getByLabelText('Barrio'), 'CORDON')
    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/guides?status=published&neighborhood=CORDON', expect.anything()))
  })

  it('featured desde la fila; si falla, vuelve atrás con el error', async () => {
    let fail = false
    stubApi((url, init) => {
      if (url === '/api/guides/g1/featured') return fail ? json({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo cambiar el destacado.' } }, 500) : json({ featured: JSON.parse(String(init?.body)).featured })
      if (url.startsWith('/api/guides')) return json({ guides: [summary({})], neighborhoods: [] })
    })
    render(<GuidesPage />)
    const toggle = await screen.findByRole('checkbox', { name: /Destacar Cafés/ })
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    fail = true
    await userEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cambiar el destacado.')
    expect(toggle).toBeChecked()
  })

  it('vacío y error con reintentar', async () => {
    let calls = 0
    stubApi((url) => (url.startsWith('/api/guides') ? (++calls === 1 ? json({ error: { code: 'UNKNOWN_ERROR', message: 'boom' } }, 500) : json({ guides: [], neighborhoods: [] })) : undefined))
    render(<GuidesPage />)
    expect(await screen.findByText('boom')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText(/Todavía no hay guías/)).toBeInTheDocument()
  })
})

describe('GuidesPage › eliminar', () => {
  it('desde el listado: confirma ("no se puede deshacer"), borra y saca la fila; cancelar no borra', async () => {
    const fetch = stubApi((url, init) => {
      if (url === '/api/guides/g2' && init?.method === 'DELETE') return json({ deleted: true })
      if (url.startsWith('/api/guides')) return json({ guides: [summary({}), summary({ id: 'g2', title: 'Sushi', status: 'draft' })], neighborhoods: [] })
    })
    render(<GuidesPage />)
    // La publicada no se puede eliminar: el botón está apagado y dice por qué.
    expect(await screen.findByRole('button', { name: 'Eliminar Cafés donde nadie te apura (despublicala primero)' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Sushi' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Esta acción no se puede deshacer.')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Sushi' }))
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar guía' }))
    await waitFor(() => expect(screen.queryByText('Sushi')).not.toBeInTheDocument())
    expect(fetch).toHaveBeenCalledWith('/api/guides/g2', { method: 'DELETE' })
    expect(screen.getByText('Cafés donde nadie te apura')).toBeInTheDocument()
  })

  it('desde el editor: un borrador se elimina y vuelve al listado; si el servidor la rechaza, el error queda en el diálogo', async () => {
    let refuse = true
    let deleted = false
    stubApi((url, init) => {
      if (url === '/api/guides/g1' && init?.method === 'DELETE') {
        if (refuse) return json({ error: { code: 'GUIDE_PUBLISHED', message: 'Una guía publicada no se puede eliminar: despublicala primero.' } }, 409)
        deleted = true
        return json({ deleted: true })
      }
      if (url === '/api/guides/g1') return json({ guide: detail() })
      if (url === '/api/guides') return json({ guides: deleted ? [] : [summary({ status: 'draft' })], neighborhoods: [] })
    })
    render(<GuidesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cafés donde nadie te apura' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Eliminar guía' }))
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar guía' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('despublicala primero')

    refuse = false
    await userEvent.click(within(dialog).getByRole('button', { name: 'Eliminar guía' }))
    expect(await screen.findByText(/Todavía no hay guías/)).toBeInTheDocument()
  })

  it('una guía publicada: "Eliminar guía" apagado en el editor, con el aviso de despublicar', async () => {
    stubApi((url) => {
      if (url === '/api/guides/g1') return json({ guide: detail({ status: 'published', publishedAt: '2026-11-19T12:00:00Z', places: [1, 2, 3, 4].map((n) => place(n)) }) })
      if (url === '/api/guides') return json({ guides: [summary({})], neighborhoods: [] })
    })
    render(<GuidesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cafés donde nadie te apura' }))
    expect(await screen.findByRole('button', { name: 'Eliminar guía' })).toBeDisabled()
    expect(screen.getByText('Para eliminar una guía publicada, despublicala primero.')).toBeInTheDocument()
  })
})

describe('GuidesPage › editor', () => {
  it('agregar al final, sacar renumera, y Publicar se habilita con 4 lugares', async () => {
    let saved = detail()
    stubApi((url, init) => {
      if (url === '/api/guides?' || url === '/api/guides') return json({ guides: [summary({})], neighborhoods: [] })
      if (url === '/api/guides/g1' && (!init || init.method === undefined)) return json({ guide: saved })
      if (url.startsWith('/api/places?')) return json({ places: [{ id: place(4).placeId, name: 'Lugar 4', neighborhoodId: 'CORDON', status: 'published' }], total: 1, counts: { all: 1, published: 1, review: 0 } })
      if (url === '/api/guides/g1' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        saved = { ...saved, ...body.guide, places: body.guide.places.map((entry: { placeId: string; text: string }, index: number) => ({ ...place(index + 1), ...entry })) }
        return json({ guide: saved })
      }
      if (url === '/api/guides/g1/publish') return json({ guide: { ...saved, status: 'published', publishedAt: '2026-11-19T12:00:00Z' } })
    })
    render(<GuidesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cafés donde nadie te apura' }))
    const list = await screen.findByRole('list', { name: 'Lugares de la guía' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
    expect(screen.getByText(/Hacen falta al menos 4 lugares publicados \(hay 3\)/)).toBeInTheDocument()

    await userEvent.type(screen.getByPlaceholderText('Buscar lugares publicados por nombre'), 'Lug')
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar Lugar 4' }))
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent?.slice(0, 1))).toEqual(['1', '2', '3', '4'])
    await userEvent.type(screen.getByLabelText('Texto de Lugar 4'), 'Por qué')
    expect(screen.getByRole('button', { name: 'Lugar 4 ya está agregado' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Sacar Lugar 1' }))
    const names = within(list).getAllByRole('listitem').map((item) => item.querySelector('.font-medium')?.textContent)
    expect(names).toEqual(['Lugar 2', 'Lugar 3', 'Lugar 4'])
    expect(within(list).getAllByRole('listitem')[0].textContent?.startsWith('1')).toBe(true)
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled()
  })

  it('publicar guarda antes los cambios y avisa la caché', async () => {
    let saved = detail({ places: [1, 2, 3, 4].map((n) => place(n)) })
    const fetch = stubApi((url, init) => {
      if (url === '/api/guides') return json({ guides: [summary({ status: 'draft' })], neighborhoods: [] })
      if (url === '/api/guides/g1' && !init?.method) return json({ guide: saved })
      if (url === '/api/guides/g1' && init?.method === 'PUT') {
        saved = { ...saved, ...JSON.parse(String(init.body)).guide, places: saved.places }
        return json({ guide: saved })
      }
      if (url === '/api/guides/g1/publish') return json({ guide: { ...saved, status: 'published' } })
    })
    render(<GuidesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cafés donde nadie te apura' }))
    const title = await screen.findByLabelText('Título')
    await userEvent.type(title, ' de Cordón')
    await userEvent.click(screen.getByRole('checkbox', { name: /Sólo corrección/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/Publicada/)
    const put = fetch.mock.calls.find(([url, init]) => url === '/api/guides/g1' && init?.method === 'PUT')!
    expect(JSON.parse(String(put[1]!.body))).toMatchObject({ keepDate: true, guide: { title: 'Cafés de Cordón' } })
    expect(screen.getByRole('button', { name: 'Despublicar' })).toBeInTheDocument()
  })

  it('un slug de barrio se marca y no deja abrir la vista previa; con slug válido abre la URL del servidor', async () => {
    const opened = { location: { href: '' }, close: vi.fn() }
    vi.stubGlobal('open', vi.fn(() => opened))
    stubApi((url, init) => {
      if (url === '/api/guides') return json({ guides: [summary({ status: 'draft' })], neighborhoods: [] })
      if (url === '/api/guides/g1' && !init?.method) return json({ guide: detail() })
      if (url === '/api/guides/g1/preview-url') return json({ url: 'http://localhost:3000/guides/montevideo/cordon/cafes-donde-nadie-te-apura?preview=k' })
    })
    render(<GuidesPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cafés donde nadie te apura' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Vista previa' }))
    await waitFor(() => expect(opened.location.href).toBe('http://localhost:3000/guides/montevideo/cordon/cafes-donde-nadie-te-apura?preview=k'))

    const slug = screen.getByDisplayValue('cafes-donde-nadie-te-apura')
    await userEvent.clear(slug)
    await userEvent.type(slug, 'pocitos')
    expect(screen.getAllByText('"pocitos" es el nombre de un barrio: elegí otro slug.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Vista previa' })).toBeDisabled()
  })
})
