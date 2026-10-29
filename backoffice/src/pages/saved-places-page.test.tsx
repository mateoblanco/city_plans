import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GoogleRating, PlaceListItem } from '@/types/places'
import { SavedPlacesPage } from './saved-places-page'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const place = (overrides: Partial<PlaceListItem>): PlaceListItem => ({
  id: 'uuid-1', googlePlaceId: 'ChIJpalenque', name: 'El Palenque', neighborhoodId: 'CIUDAD VIEJA', categories: ['restaurant'], tags: ['cash_only', 'kids_friendly'],
  status: 'published', hoursStatus: 'exact', price: 'moderate', updatedAt: '2026-10-12T15:30:00.000Z', hasEmbedding: true,
  prominence: 0.125, igFollowers: null, brandKey: null, instagram: null, featured: false,
  logoUrl: null, logoKind: null, logoBgColor: null, logoColor: null, iconCategory: 'grill', style: null, reviewReasons: [], editedFields: [], ...overrides,
})

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Servidor de mentira con los mismos filtros, orden y paginación que GET /api/places. Las escrituras (destacado,
 * publicar) cambian su estado; `fail` hace fallar las rutas que se le pasen.
 */
type FakeRatings = Record<string, GoogleRating | 'fail'>

function fakeServer(rows: PlaceListItem[], fail: { list?: number; featured?: boolean; publish?: boolean; price?: boolean; ratings?: boolean; neighborhoods?: boolean } = {}, hold?: Promise<void>, ratings: FakeRatings = {}) {
  const data = rows.map((row) => ({ ...row }))
  let listFailures = fail.list ?? 0
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost')
    const write = url.pathname.match(/^\/api\/places\/([^/]+)\/(featured|status)$/)
    if (write) {
      const [, id, kind] = write
      if (kind === 'featured') {
        if (fail.featured) return jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo guardar el destacado.' } }, 500)
        data.find((row) => row.id === id)!.featured = JSON.parse(String(init?.body)).featured
        return jsonResponse({ id, featured: true })
      }
      if (fail.publish) return jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo publicar el lugar.' } }, 500)
      data.find((row) => row.id === id)!.status = 'published'
      return jsonResponse({ id, status: 'published' })
    }
    const edit = url.pathname.match(/^\/api\/places\/([^/]+)$/)
    if (edit && init?.method === 'PATCH') {
      await hold
      if (fail.price) return jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo guardar el precio.' } }, 500)
      const row = data.find((item) => item.id === edit[1])!
      row.price = JSON.parse(String(init.body)).edit.price
      row.editedFields = [...new Set([...row.editedFields, 'price' as const])]
      return jsonResponse({ place: { ...row, editedFields: row.editedFields }, warnings: [] })
    }
    if (url.pathname === '/api/places/neighborhoods') {
      if (fail.neighborhoods) return jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudieron cargar los barrios.' } }, 500)
      const counts = new Map<string, number>()
      for (const row of data) counts.set(row.neighborhoodId, (counts.get(row.neighborhoodId) ?? 0) + 1)
      return jsonResponse({ neighborhoods: [...counts].map(([id, count]) => ({ id, count })) })
    }
    if (url.pathname === '/api/places/google-ratings') {
      await hold
      if (fail.ratings) return jsonResponse({ error: { code: 'QUOTA_ERROR', message: 'Se agotó la cuota de Google Places.' } }, 429)
      const ids: string[] = JSON.parse(String(init?.body)).ids
      const result = { ratings: {} as Record<string, GoogleRating>, failed: [] as { id: string; message: string }[], skipped: 0 }
      for (const id of ids) {
        const rating = ratings[id]
        if (rating === 'fail') result.failed.push({ id, message: 'Google Places no respondió.' })
        else result.ratings[id] = rating ?? { rating: null, userRatingCount: null }
      }
      return jsonResponse(result)
    }
    if (url.pathname !== '/api/places' && url.pathname !== '/api/places/ids') throw new Error(`Ruta inesperada ${input}`)
    if (listFailures > 0) {
      listFailures -= 1
      return jsonResponse({ error: { code: 'CONFIGURATION_ERROR', message: 'Falta configurar DATABASE_URL en .env.local.' } }, 503)
    }
    const params = url.searchParams
    const q = params.get('q')
    const filtered = data.filter((row) => (!q || fold(row.name).includes(fold(q)))
      && (!params.get('neighborhood') || row.neighborhoodId === params.get('neighborhood'))
      && (!params.get('category') || row.categories.includes(params.get('category')!))
      && (!params.get('edited') || row.editedFields.length > 0)
      && (!params.get('reason') || row.reviewReasons.includes(params.get('reason') as never))
      && (!params.get('missing') || params.get('missing')!.split(',').some((field) => ({
        price: row.price === 'unknown', hours: row.hoursStatus === 'none', logo: row.logoUrl === null, instagram: row.instagram === null,
      } as Record<string, boolean>)[field])))
    const withStatus = filtered.filter((row) => !params.get('status') || row.status === params.get('status'))
    const sort = params.get('sort') ?? 'recent'
    withStatus.sort((a, b) => sort === 'prominence' ? b.prominence - a.prominence : sort === 'name' ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt))
    if (url.pathname === '/api/places/ids') return jsonResponse({ ids: withStatus.map((row) => row.id), withoutGoogleId: [] })
    const ids = params.get('ids')?.split(',')
    const listed = ids ? ids.flatMap((id) => withStatus.filter((row) => row.id === id)) : withStatus
    const page = Number(params.get('page') ?? 1)
    const size = Number(params.get('pageSize'))
    return jsonResponse({
      places: listed.slice((page - 1) * size, page * size),
      total: listed.length,
      counts: { all: filtered.length, published: filtered.filter((row) => row.status === 'published').length, review: filtered.filter((row) => row.status === 'review').length },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const names = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent)
const listCalls = (fetchMock: ReturnType<typeof fakeServer>) => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith('/api/places?'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SavedPlacesPage', () => {
  it('muestra el total y una fila por lugar', async () => {
    const fetchMock = fakeServer([
      place({}),
      place({ id: 'uuid-2', name: 'Café Sin Nada', categories: [], tags: [], status: 'draft', hoursStatus: 'none', hasEmbedding: false, updatedAt: '2026-10-01T15:30:00.000Z' }),
    ])
    render(<SavedPlacesPage />)

    expect(await screen.findByText('2 lugares')).toBeTruthy()
    expect(listCalls(fetchMock)).toEqual(['/api/places?pageSize=50'])
    const [, first, second] = screen.getAllByRole('row')
    expect(within(first).getByText('El Palenque')).toBeTruthy()
    expect(within(first).getByText('Ciudad Vieja')).toBeTruthy()
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
    fakeServer([
      place({ logoUrl: 'https://logos.example/logos/p-0a1b2c3d.webp', logoKind: 'logo', logoBgColor: '#ffffff', logoColor: '#1e6fd9' }),
      place({ id: 'uuid-2', name: 'Café Sin Logo', iconCategory: 'coffee', updatedAt: '2026-10-11T15:30:00.000Z' }),
      place({ id: 'uuid-3', name: 'Sin Categoría', iconCategory: null, updatedAt: '2026-10-10T15:30:00.000Z' }),
    ])
    render(<SavedPlacesPage />)

    await screen.findByText('3 lugares')
    const [, first, second, third] = screen.getAllByRole('row')
    expect(within(first).getByRole('img', { name: 'Logo de El Palenque' }).getAttribute('src')).toBe('https://logos.example/logos/p-0a1b2c3d.webp')
    expect(within(first).getByRole('img', { name: 'grill' }).textContent).toBe('🥩')
    expect(within(second).getByRole('img', { name: 'coffee' }).textContent).toBe('☕')
    expect(within(third).getByRole('img', { name: 'Sin categoría' }).textContent).toBe('🍽️')
    expect(within(first).getByText('Logo')).toBeTruthy()
    expect(within(first).getByTitle('Fondo: #ffffff')).toBeTruthy()
    expect(within(first).getByTitle('Principal: #1e6fd9')).toBeTruthy()
    expect(within(second).getByText('Sin logo')).toBeTruthy()
  })

  it('muestra el estado de carga y el vacío', async () => {
    fakeServer([])
    render(<SavedPlacesPage />)

    expect(screen.getByLabelText('Cargando lugares')).toBeTruthy()
    expect(await screen.findByText('Todavía no hay lugares guardados')).toBeTruthy()
    expect(screen.getByText('0 lugares')).toBeTruthy()
  })

  it('muestra el error y permite reintentar', async () => {
    fakeServer([place({})], { list: 1 })
    render(<SavedPlacesPage />)

    expect(await screen.findByText('Falta configurar DATABASE_URL en .env.local.')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('1 lugar')).toBeTruthy()
  })

  it('muestra la prominencia, los seguidores, la marca y la marca de editado a mano', async () => {
    fakeServer([
      place({ id: 'a', prominence: 0.5432, igFollowers: 12345, brandKey: 'cordon-beer', editedFields: ['name', 'tags'] }),
      place({ id: 'b', name: 'Sin marca', updatedAt: '2026-10-01T15:30:00.000Z' }),
    ])
    render(<SavedPlacesPage />)

    await screen.findByText('2 lugares')
    const header = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    const [, branded, plain] = screen.getAllByRole('row')
    expect(within(branded).getByText('0.54')).toBeTruthy()
    expect(within(branded).getByText('12.345')).toBeTruthy()
    expect(within(branded).getAllByRole('cell')[header.indexOf('Marca')].textContent).toBe('cordon-beer')
    expect(within(plain).getAllByRole('cell')[header.indexOf('Marca')].textContent).toBe('—')
    expect(within(branded).getByLabelText('Editado a mano')).toBeTruthy()
    expect(within(plain).queryByLabelText('Editado a mano')).toBeNull()
  })

  it('busca por nombre en el servidor, sin acentos', async () => {
    const fetchMock = fakeServer([place({}), place({ id: 'b', name: 'Café Brasilero', updatedAt: '2026-10-01T15:30:00.000Z' })])
    render(<SavedPlacesPage />)
    await screen.findByText('2 lugares')

    await userEvent.setup().type(screen.getByPlaceholderText('Buscar por nombre'), 'cafe')

    await waitFor(() => expect(names()).toEqual(['Café Brasilero']))
    expect(listCalls(fetchMock).at(-1)).toBe('/api/places?q=cafe&pageSize=50')
    expect(screen.getByRole('status')).toHaveTextContent('1 lugar')
  })

  it('filtra por barrio, categoría y editado a mano, y ordena; sin resultados avisa', async () => {
    const fetchMock = fakeServer([
      place({ id: 'a', name: 'Bar Reciente', categories: ['bar'], neighborhoodId: 'POCITOS', prominence: 0.2 }),
      place({ id: 'b', name: 'Bar Prominente', categories: ['bar'], neighborhoodId: 'POCITOS', prominence: 0.9, updatedAt: '2026-10-01T15:30:00.000Z', editedFields: ['style'] }),
      place({ id: 'c', name: 'Resto', neighborhoodId: 'CENTRO', updatedAt: '2026-10-02T15:30:00.000Z' }),
    ])
    render(<SavedPlacesPage />)
    await screen.findByText('3 lugares')
    const user = userEvent.setup()

    await user.selectOptions(screen.getByLabelText('Barrio'), 'POCITOS')
    await waitFor(() => expect(names()).toEqual(['Bar Reciente', 'Bar Prominente']))
    await user.selectOptions(screen.getByLabelText('Orden'), 'prominence')
    await waitFor(() => expect(names()).toEqual(['Bar Prominente', 'Bar Reciente']))
    expect(screen.getByRole('columnheader', { name: 'Prominencia' })).toHaveAttribute('aria-sort', 'descending')
    await user.click(screen.getByRole('checkbox', { name: 'Editado a mano' }))
    await waitFor(() => expect(names()).toEqual(['Bar Prominente']))
    expect(listCalls(fetchMock).at(-1)).toBe('/api/places?neighborhood=POCITOS&edited=1&sort=prominence&pageSize=50')
    await user.selectOptions(screen.getByLabelText('Categoría'), 'cafe')
    expect(await screen.findByText('Ningún lugar coincide con los filtros')).toBeTruthy()
  })

  it('el filtro de barrio sólo ofrece los barrios con lugares guardados, con la cantidad', async () => {
    fakeServer([
      place({ id: 'a', neighborhoodId: 'POCITOS' }),
      place({ id: 'b', neighborhoodId: 'POCITOS', updatedAt: '2026-10-11T15:30:00.000Z' }),
      place({ id: 'c', neighborhoodId: 'CIUDAD VIEJA', updatedAt: '2026-10-10T15:30:00.000Z' }),
    ])
    render(<SavedPlacesPage />)
    const select = screen.getByLabelText('Barrio')
    await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Todos', 'Ciudad Vieja (1)', 'Pocitos (2)']))
  })

  it('si no se pudieron cargar los barrios, el filtro sólo ofrece "Todos" y la lista carga igual', async () => {
    fakeServer([place({})], { neighborhoods: true })
    render(<SavedPlacesPage />)
    await screen.findByText('1 lugar')
    expect(within(screen.getByLabelText('Barrio')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Todos'])
  })

  it('"Le falta…": cualquiera de los elegidos, en el servidor y junto con barrio y estado', async () => {
    const logo = { logoUrl: 'https://logos.example/logos/a-0a1b2c3d.webp', logoKind: 'logo' as const }
    const fetchMock = fakeServer([
      place({ id: 'a', name: 'Completo', instagram: 'completo', ...logo }),
      place({ id: 'b', name: 'Sin Precio', price: 'unknown', instagram: 'sinprecio', ...logo, updatedAt: '2026-10-11T15:30:00.000Z' }),
      place({ id: 'c', name: 'Sin IG', ...logo, updatedAt: '2026-10-10T15:30:00.000Z' }),
      place({ id: 'd', name: 'Sin IG Centro', neighborhoodId: 'CENTRO', ...logo, updatedAt: '2026-10-09T15:30:00.000Z' }),
      place({ id: 'e', name: 'Sin Horario', hoursStatus: 'none', instagram: 'sinhorario', status: 'review', ...logo, updatedAt: '2026-10-08T15:30:00.000Z' }),
    ])
    render(<SavedPlacesPage />)
    await screen.findByText('5 lugares')
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Le falta…' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Precio' }))
    await waitFor(() => expect(names()).toEqual(['Sin Precio']))
    await user.click(screen.getByRole('checkbox', { name: 'Instagram' }))
    await waitFor(() => expect(names()).toEqual(['Sin Precio', 'Sin IG', 'Sin IG Centro']))
    expect(listCalls(fetchMock).at(-1)).toBe('/api/places?missing=price%2Cinstagram&pageSize=50')
    expect(screen.getByRole('button', { name: 'Le falta… (2)' })).toBeTruthy()

    await user.click(screen.getByRole('checkbox', { name: 'Horario' }))
    await user.selectOptions(screen.getByLabelText('Barrio'), 'CIUDAD VIEJA')
    await waitFor(() => expect(names()).toEqual(['Sin Precio', 'Sin IG', 'Sin Horario']))
    await user.click(screen.getByRole('button', { name: /^A revisar/ }))
    await waitFor(() => expect(names()).toEqual(['Sin Horario']))
    expect(listCalls(fetchMock).at(-1)).toBe('/api/places?neighborhood=CIUDAD+VIEJA&status=review&missing=price%2Chours%2Cinstagram&pageSize=50')
  })

  it('cambia el precio desde la fila sin abrir el modal: guardando, guardado y editado a mano', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => { release = resolve })
    const fetchMock = fakeServer([place({})], {}, hold)
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    const select = await screen.findByLabelText('Precio de El Palenque')
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['$', '$$', '$$$', '$$$$', 'Sin precio'])
    await user.selectOptions(select, 'very_high')
    const status = screen.getByLabelText('Guardado del precio de El Palenque')
    expect(status).toHaveTextContent('Guardando…')
    expect(select).toBeDisabled()
    release()
    await waitFor(() => expect(status).toHaveTextContent('Guardado'))
    expect(select).toHaveValue('very_high')
    expect(within(screen.getAllByRole('row')[1]).getByLabelText('Editado a mano')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/places/uuid-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ edit: { price: 'very_high' } }) }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('si no se pudo guardar el precio, vuelve al anterior con el error en la celda', async () => {
    fakeServer([place({ price: 'low' })], { price: true })
    render(<SavedPlacesPage />)

    const select = await screen.findByLabelText('Precio de El Palenque')
    await userEvent.setup().selectOptions(select, 'unknown')

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar el precio.')
    expect(select).toHaveValue('low')
    expect(select).toBeEnabled()
  })

  it('muestra el Instagram con link al perfil, sin abrir el modal; sin Instagram, un guion', async () => {
    const fetchMock = fakeServer([place({ id: 'a', instagram: 'elpalenque.mvd' }), place({ id: 'b', name: 'Sin IG', updatedAt: '2026-10-01T15:30:00.000Z' })])
    render(<SavedPlacesPage />)
    await screen.findByText('2 lugares')
    const header = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    const [, withIg, without] = screen.getAllByRole('row')

    const link = within(withIg).getByRole('link', { name: '@elpalenque.mvd' })
    expect(link).toHaveAttribute('href', 'https://www.instagram.com/elpalenque.mvd/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(within(without).getAllByRole('cell')[header.indexOf('Instagram')].textContent).toBe('—')
    await userEvent.setup().click(link)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/places/a')).toBe(false)
  })

  it('las columnas empiezan por nombre, categorías, Instagram y precio', async () => {
    fakeServer([place({})])
    render(<SavedPlacesPage />)
    await screen.findByText('1 lugar')
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Nombre', 'Google Maps', 'Categorías', 'Instagram', 'Precio', 'Logo', 'Barrio', 'Tags', 'Status', 'Horario', 'Embedding', 'Prominencia', 'Seguidores', 'Marca',
      'Destacado', 'Última actualización',
    ])
  })

  it('"Ver puntaje de Google": confirma pedidos y costo de los filtrados, muestra el puntaje sin guardarlo y reintenta sólo los que fallaron', async () => {
    let release: () => void = () => {}
    const hold = new Promise<void>((resolve) => { release = resolve })
    const fetchMock = fakeServer([
      place({ id: 'a', name: 'Pocitos Uno', neighborhoodId: 'POCITOS' }),
      place({ id: 'b', name: 'Pocitos Dos', neighborhoodId: 'POCITOS', updatedAt: '2026-10-11T15:30:00.000Z' }),
      place({ id: 'c', name: 'Pocitos Tres', neighborhoodId: 'POCITOS', updatedAt: '2026-10-10T15:30:00.000Z' }),
      place({ id: 'd', name: 'Centro', neighborhoodId: 'CENTRO', updatedAt: '2026-10-09T15:30:00.000Z' }),
    ], {}, hold, { a: { rating: 4.62, userRatingCount: 1234 }, b: 'fail', c: { rating: null, userRatingCount: null } })
    render(<SavedPlacesPage />)
    await screen.findByText('4 lugares')
    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('Barrio'), 'POCITOS')
    await waitFor(() => expect(names()).toHaveLength(3))

    await user.click(screen.getByRole('button', { name: 'Ver puntaje de Google' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Son 3 pedidos')
    expect(dialog).toHaveTextContent('US$ 0,06')
    expect(dialog).toHaveTextContent('no se guarda')
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/places/google-ratings')).toBe(false)
    await user.click(within(dialog).getByRole('button', { name: 'Consultar' }))
    expect(await screen.findByRole('button', { name: 'Consultando 3…' })).toBeDisabled()
    release()

    expect(await screen.findByText(/1 no se pudo consultar/)).toBeTruthy()
    const header = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(header.indexOf('Puntaje de Google')).toBe(header.indexOf('Precio') + 1)
    const cell = (name: string) => within(screen.getByRole('row', { name: new RegExp(name) })).getAllByRole('cell')[header.indexOf('Puntaje de Google')].textContent
    expect(cell('Pocitos Uno')).toBe('4,6 (1.234)')
    expect(cell('Pocitos Dos')).toBe('Error')
    expect(cell('Pocitos Tres')).toBe('Sin puntaje')
    const ratingCall = fetchMock.mock.calls.find(([url]) => url === '/api/places/google-ratings')!
    expect(JSON.parse(String(ratingCall[1]?.body))).toEqual({ ids: ['a', 'b', 'c'] })

    await user.click(screen.getByRole('button', { name: 'Ver puntaje de Google' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('Es 1 pedido')
    await user.click(screen.getByRole('button', { name: 'Volver' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('ordena por puntaje de Google entre todas las páginas, con los que no tienen puntaje al final', async () => {
    const many = Array.from({ length: 60 }, (_, index) => place({ id: `p${index}`, name: `Lugar ${String(index).padStart(2, '0')}`, updatedAt: `2026-10-12T15:${String(59 - index).padStart(2, '0')}:00.000Z` }))
    const ratings: FakeRatings = Object.fromEntries(many.map((row, index) => [row.id, { rating: index === 0 ? null : index / 20, userRatingCount: index }]))
    const fetchMock = fakeServer(many, {}, undefined, ratings)
    render(<SavedPlacesPage />)
    await screen.findByText('60 lugares')
    const user = userEvent.setup()
    expect(within(screen.getByLabelText('Orden')).getByRole('option', { name: 'Puntaje de Google (mayor primero)' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Ver puntaje de Google' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('US$ 1,20')
    await user.click(screen.getByRole('button', { name: 'Consultar' }))
    await screen.findByText(/Puntaje de Google de 60 lugares/)

    await user.selectOptions(screen.getByLabelText('Orden'), 'rating_desc')
    // El mayor puntaje es el último del servidor (página 2): el orden es de todos los filtrados, no de la página.
    await waitFor(() => expect(names()[0]).toBe('Lugar 59'))
    expect(screen.getByRole('columnheader', { name: 'Puntaje de Google' })).toHaveAttribute('aria-sort', 'descending')
    expect(listCalls(fetchMock).at(-1)).toMatch(/^\/api\/places\?ids=p59%2Cp58%2C/)
    await user.selectOptions(screen.getByLabelText('Orden'), 'rating_asc')
    await waitFor(() => expect(names()[0]).toBe('Lugar 01'))
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('Página 2 de 2')
    await waitFor(() => expect(names().at(-1)).toBe('Lugar 00'))
  })

  it('si Google falla en todos, muestra el error y marca las filas con error', async () => {
    fakeServer([place({})], { ratings: true })
    render(<SavedPlacesPage />)
    await screen.findByText('1 lugar')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Ver puntaje de Google' }))
    await user.click(await screen.findByRole('button', { name: 'Consultar' }))
    expect(await screen.findByText('No se pudo consultar el puntaje de Google')).toBeTruthy()
    expect(screen.getByText('Se agotó la cuota de Google Places.')).toBeTruthy()
    const header = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(within(screen.getAllByRole('row')[1]).getAllByRole('cell')[header.indexOf('Puntaje de Google')].textContent).toBe('Error')
  })

  it('link a la ficha de Google Maps en la segunda columna, sin abrir el modal; sin googlePlaceId, un guion', async () => {
    const fetchMock = fakeServer([place({ id: 'a' }), place({ id: 'b', name: 'Sin Google', googlePlaceId: null, updatedAt: '2026-10-01T15:30:00.000Z' })])
    render(<SavedPlacesPage />)
    await screen.findByText('2 lugares')
    const [, withId, without] = screen.getAllByRole('row')

    const link = within(withId).getByRole('link', { name: 'Ver El Palenque en Google Maps' })
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=El+Palenque&query_place_id=ChIJpalenque')
    expect(link).toHaveAttribute('target', '_blank')
    expect(within(withId).getAllByRole('cell')[1]).toContainElement(link)
    expect(within(without).getAllByRole('cell')[1].textContent).toBe('—')
    await userEvent.setup().click(link)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/places/a')).toBe(false)
  })

  it('pagina en el servidor', async () => {
    const many = Array.from({ length: 60 }, (_, index) => place({ id: `p${index}`, name: `Lugar ${String(index).padStart(2, '0')}` }))
    const fetchMock = fakeServer(many)
    render(<SavedPlacesPage />)
    await screen.findByText('60 lugares')
    const user = userEvent.setup()

    expect(screen.getAllByRole('row')).toHaveLength(51)
    expect(screen.getByText('Página 1 de 2')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Anterior/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /Siguiente/ }))
    await screen.findByText('Página 2 de 2')
    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(11))
    expect(listCalls(fetchMock).at(-1)).toBe('/api/places?page=2&pageSize=50')
    expect(screen.getByRole('button', { name: /Siguiente/ })).toBeDisabled()
  })

  it('guarda el destacado directo, sin abrir el modal', async () => {
    const fetchMock = fakeServer([place({})])
    render(<SavedPlacesPage />)

    const checkbox = await screen.findByLabelText('Destacar El Palenque') as HTMLInputElement
    await userEvent.setup().click(checkbox)

    expect(checkbox.checked).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/places/uuid-1/featured', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ featured: true }) }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('revierte el destacado y muestra el error si no se pudo guardar', async () => {
    fakeServer([place({ featured: true })], { featured: true })
    render(<SavedPlacesPage />)

    const checkbox = await screen.findByLabelText('Destacar El Palenque') as HTMLInputElement
    await userEvent.setup().click(checkbox)

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo guardar el destacado.')
    expect(checkbox.checked).toBe(true)
    expect(checkbox.disabled).toBe(false)
  })

  it('las pestañas filtran por status en el servidor; A revisar muestra los motivos', async () => {
    const fetchMock = fakeServer([
      place({}),
      place({ id: 'uuid-2', name: 'VÜS Café', status: 'review', reviewReasons: ['not_open_yet'], updatedAt: '2026-10-11T15:30:00.000Z' }),
      place({ id: 'uuid-3', name: 'Ébano', status: 'review', reviewReasons: ['no_place_facts', 'restaurant_without_food'], updatedAt: '2026-10-10T15:30:00.000Z' }),
    ])
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    expect(await screen.findByRole('button', { name: 'Todos (3)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Publicados (1)' })).toBeTruthy()
    expect(screen.queryByText('Motivos')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'A revisar (2)' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 lugares'))
    expect(listCalls(fetchMock).at(-1)).toBe('/api/places?status=review&pageSize=50')
    expect(screen.queryByText('El Palenque')).toBeNull()
    expect(within(screen.getByRole('table')).getByText('Todavía no abrió')).toBeInTheDocument()
    expect(screen.getByText('Sin datos del local: las fuentes eran de otros lugares · Restaurante sin comidas')).toBeInTheDocument()
  })

  it('A revisar filtra por motivo en el servidor, con Puntaje bajo en Google; al salir de la pestaña se limpia', async () => {
    const fetchMock = fakeServer([
      place({}),
      place({ id: 'uuid-2', name: 'VÜS Café', status: 'review', reviewReasons: ['not_open_yet'] }),
      place({ id: 'uuid-3', name: 'Bar Flojo', status: 'review', reviewReasons: ['low_rating'] }),
    ])
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    await screen.findByRole('button', { name: 'Todos (3)' })
    expect(screen.queryByLabelText('Motivo')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'A revisar (2)' }))
    await user.selectOptions(await screen.findByLabelText('Motivo'), 'Puntaje bajo en Google')

    await waitFor(() => expect(listCalls(fetchMock).at(-1)).toBe('/api/places?status=review&reason=low_rating&pageSize=50'))
    expect(await screen.findByText('Bar Flojo')).toBeInTheDocument()
    expect(screen.queryByText('VÜS Café')).toBeNull()

    await user.click(screen.getByRole('button', { name: /^Todos/ }))
    await waitFor(() => expect(listCalls(fetchMock).at(-1)).toBe('/api/places?pageSize=50'))
    expect(screen.queryByLabelText('Motivo')).toBeNull()
  })

  it('A revisar vacío', async () => {
    fakeServer([place({})])
    render(<SavedPlacesPage />)

    await userEvent.setup().click(await screen.findByRole('button', { name: 'A revisar (0)' }))

    expect(await screen.findByText('No hay lugares para revisar')).toBeInTheDocument()
  })

  it('publica a mano: sale de A revisar y queda publicado', async () => {
    const fetchMock = fakeServer([place({ status: 'review', reviewReasons: ['bar_without_drinks'] })])
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'A revisar (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Publicar El Palenque' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/places/uuid-1/status', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'published' }) }))
    expect(await screen.findByText('No hay lugares para revisar')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Todos (1)' }))
    expect(await screen.findByText('Publicado', { selector: 'td' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('si no se pudo publicar, vuelve a A revisar con el error', async () => {
    fakeServer([place({ status: 'review', reviewReasons: ['not_open_yet'] })], { publish: true })
    render(<SavedPlacesPage />)
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'A revisar (1)' }))
    await user.click(await screen.findByRole('button', { name: 'Publicar El Palenque' }))

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'No se pudo publicar el lugar.')
    expect(screen.getByRole('button', { name: 'Publicar El Palenque' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'A revisar (1)' })).toBeInTheDocument()
  })

  it('clic en una fila abre el modal de edición', async () => {
    const fetchMock = fakeServer([place({})])
    render(<SavedPlacesPage />)
    const user = userEvent.setup()
    const [, row] = await screen.findAllByRole('row')

    // La ruta del detalle no está en el servidor de mentira: el modal muestra el error de carga.
    await user.click(within(row).getByText('Ciudad Vieja'))

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/places/uuid-1')).toBe(true)
  })
})
