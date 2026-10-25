import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaceDetail, PlaceEditPlan } from '@/types/places'
import { PlaceEditDialog } from './place-edit-dialog'

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const detail = (overrides: Partial<PlaceDetail> = {}): PlaceDetail => ({
  id: 'uuid-1', googlePlaceId: 'place-1', name: 'El Palenque', address: 'Sarandí 675', neighborhoodId: 'CIUDAD VIEJA', status: 'published', categories: ['grill'],
  tags: ['seafood', 'terrace', 'italian'], style: 'casual', iconCategory: 'grill', price: 'high', dietVegan: 'unknown', dietVegetarian: 'has_options',
  dietGlutenFree: 'no', instagram: 'elpalenque', website: null, brandKey: null, featured: false, logoUrl: null, logoKind: null, logoBgColor: null,
  logoColor: null, logoSource: null, igFollowers: 999, prominence: 0.6, manualOverrides: {}, editedFields: [], brandKeys: ['cordon-beer'],
  ...overrides,
})

const plan = (overrides: Partial<PlaceEditPlan> = {}): PlaceEditPlan => ({
  changed: ['price'], steps: [{ id: 'column_only', label: 'Sólo se guardan los campos, sin recálculos', costUsd: 0 }], totalUsd: 0, instagramOwners: [], ...overrides,
})

type Route = (init: RequestInit | undefined) => Promise<Response>

/** fetch de mentira por método y ruta; guarda los pedidos para mirar los cuerpos. */
function fakeApi(routes: Record<string, Route>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = method === 'PATCH' ? JSON.parse(String(init!.body)) : null
    const key = method === 'PATCH' ? `PATCH ${url}${body.dryRun ? ' dry' : ''}` : `${method} ${url}`
    const route = routes[key]
    if (!route) throw new Error(`Ruta inesperada ${key}`)
    return route(init)
  })
  vi.stubGlobal('fetch', fetchMock)
  const bodies = (key: string) => fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method ?? 'GET'} ${url}` === key.replace(/ dry$/, '') && (key.endsWith(' dry') === Boolean(init?.body && JSON.parse(String(init.body)).dryRun)))
    .map(([, init]) => JSON.parse(String(init!.body)))
  return { fetchMock, bodies }
}

function renderDialog() {
  const props = { onClose: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn() }
  render(<PlaceEditDialog placeId="uuid-1" {...props} />)
  return props
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('PlaceEditDialog', () => {
  it('carga el lugar, separa cocinas de tags y marca los campos editados a mano', async () => {
    fakeApi({ 'GET /api/places/uuid-1': () => jsonResponse({ place: detail({ editedFields: ['name', 'tags'] }) }) })
    renderDialog()

    expect(screen.getByText('Cargando…')).toBeTruthy()
    expect(await screen.findByLabelText('Nombre')).toHaveValue('El Palenque')
    expect(screen.getByRole('button', { name: 'Sacar Italiana' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sacar Pescados y mariscos' })).toBeTruthy()
    // Nombre, tags y cocinas (que son tags).
    expect(screen.getAllByText('editado a mano')).toHaveLength(3)
    expect(screen.getByText('No hay cambios.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })

  it('un Instagram editado a mano muestra su handle con el cartel, no "No tiene"', async () => {
    fakeApi({ 'GET /api/places/uuid-1': () => jsonResponse({ place: detail({ manualOverrides: { instagram: 'elpalenque' }, editedFields: ['instagram'] }) }) })
    renderDialog()

    const input = await screen.findByLabelText('Instagram')
    expect(input).toHaveValue('elpalenque')
    expect(input).toBeEnabled()
    expect(screen.getByRole('checkbox', { name: 'No tiene Instagram' })).not.toBeChecked()
    expect(within(input.parentElement!.parentElement!).getByText('editado a mano')).toBeTruthy()
  })

  it('los tags y cocinas agregados a mano se ven en ámbar, aunque la extracción también los traiga; los automáticos, normales', async () => {
    const manualOverrides = { tags: { add: ['terrace', 'italian'], remove: ['patio'] } } satisfies PlaceDetail['manualOverrides']
    fakeApi({ 'GET /api/places/uuid-1': () => jsonResponse({ place: detail({ manualOverrides, editedFields: ['tags'] }) }) })
    renderDialog()

    const chip = async (name: string) => (await screen.findByRole('button', { name: `Sacar ${name}` })).parentElement!
    expect((await chip('Terraza')).dataset.variant).toBe('manual')
    expect((await chip('Italiana')).dataset.variant).toBe('manual')
    expect((await chip('Pescados y mariscos')).dataset.variant).toBe('auto')
    expect(screen.queryByRole('button', { name: 'Sacar Patio' })).toBeNull()
  })

  it('muestra la dirección como link a la ficha de Google Maps', async () => {
    fakeApi({ 'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }) })
    renderDialog()

    const link = await screen.findByRole('link', { name: /Sarandí 675/ })
    expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Sarand%C3%AD+675&query_place_id=place-1')
    expect(link).toHaveAttribute('target', '_blank')
    cleanup()

    fakeApi({ 'GET /api/places/uuid-1': () => jsonResponse({ place: detail({ address: null, googlePlaceId: null }) }) })
    renderDialog()
    expect(await screen.findByText('Sin dirección')).toBeTruthy()
  })

  it('si no carga muestra el error y permite reintentar', async () => {
    const responses = [
      () => jsonResponse({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo cargar el lugar.' } }, 500),
      () => jsonResponse({ place: detail() }),
    ]
    fakeApi({ 'GET /api/places/uuid-1': () => responses.shift()!() })
    renderDialog()

    expect(await screen.findByText('No se pudo cargar el lugar.')).toBeTruthy()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByLabelText('Nombre')).toBeTruthy()
  })

  it('muestra qué se recalcula y su costo, y guarda sólo lo que cambió', async () => {
    const { bodies } = fakeApi({
      'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }),
      'PATCH /api/places/uuid-1 dry': () => jsonResponse({ plan: plan({
        changed: ['tags', 'price'],
        steps: [
          { id: 'search_texts', label: 'Texto de búsqueda y búsqueda por palabra (search_tsv)', costUsd: 0 },
          { id: 'embedding', label: 'Embedding (text-embedding-3-small)', costUsd: 0.000004 },
        ],
        totalUsd: 0.000004,
      }) }),
      'PATCH /api/places/uuid-1': () => jsonResponse({ place: detail({ price: 'low' }), warnings: [] }),
    })
    const props = renderDialog()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Sacar Pescados y mariscos' }))
    await user.selectOptions(screen.getByLabelText('Precio'), 'low')

    const recalc = screen.getByRole('region', { name: 'Recálculo al guardar' })
    expect(await within(recalc).findByText('Embedding (text-embedding-3-small)')).toBeTruthy()
    expect(within(recalc).getByText('Total: ≈ US$ 0.000004')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    expect(bodies('PATCH /api/places/uuid-1')).toEqual([{ edit: { tags: ['terrace', 'italian'], price: 'low' }, confirmSharedInstagram: false }])
    expect(props.onSaved).toHaveBeenCalledWith(expect.objectContaining({ price: 'low' }))
  })

  it('un Instagram mal escrito no se puede guardar; "No tiene" lo deja en null', async () => {
    const { bodies } = fakeApi({
      'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }),
      'PATCH /api/places/uuid-1 dry': () => jsonResponse({ plan: plan() }),
      'PATCH /api/places/uuid-1': () => jsonResponse({ place: detail({ instagram: null }), warnings: [] }),
    })
    renderDialog()
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Instagram')

    await user.clear(input)
    await user.type(input, 'no es un handle!')
    expect(screen.getByText('Poné un @usuario o la URL del perfil, o marcá «No tiene».')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()

    await user.click(screen.getByLabelText('No tiene Instagram'))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(bodies('PATCH /api/places/uuid-1')).toEqual([{ edit: { instagram: null }, confirmSharedInstagram: false }]))
  })

  it('si el Instagram ya lo tiene otro lugar, muestra quién y deja confirmar que es otra sucursal', async () => {
    const owners = [{ id: 'uuid-2', name: 'El Palenque Pocitos', neighborhoodId: 'POCITOS', brandKey: 'el-palenque' }]
    const saves = [
      () => jsonResponse({ error: { code: 'INSTAGRAM_IN_USE', message: '@palenque.uy ya está en El Palenque Pocitos.' }, owners }, 409),
      () => jsonResponse({ place: detail({ instagram: 'palenque.uy' }), warnings: [] }),
    ]
    const { bodies } = fakeApi({
      'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }),
      'PATCH /api/places/uuid-1 dry': () => jsonResponse({ plan: plan({ changed: ['instagram'], instagramOwners: owners }) }),
      'PATCH /api/places/uuid-1': () => saves.shift()!(),
    })
    const props = renderDialog()
    const user = userEvent.setup()
    const input = await screen.findByLabelText('Instagram')

    await user.clear(input)
    await user.type(input, 'https://www.instagram.com/palenque.uy/')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Ese Instagram ya lo tiene otro lugar')).toBeTruthy()
    expect(screen.getByText('El Palenque Pocitos (Pocitos) · marca el-palenque')).toBeTruthy()
    expect(props.onSaved).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Es otra sucursal: guardar' }))

    await waitFor(() => expect(props.onClose).toHaveBeenCalled())
    expect(bodies('PATCH /api/places/uuid-1')).toEqual([
      { edit: { instagram: 'palenque.uy' }, confirmSharedInstagram: false },
      { edit: { instagram: 'palenque.uy' }, confirmSharedInstagram: true },
    ])
  })

  it('guardado con avisos: queda abierto y los muestra; un error de guardado se muestra sin cerrar', async () => {
    const saves = [
      () => jsonResponse({ error: { code: 'INSTAGRAM_NOT_FOUND', message: 'No existe el perfil @noexiste (o es privado). No se guardó nada.' } }, 422),
      () => jsonResponse({ place: detail({ name: 'Palenque' }), warnings: ['Se guardó, pero no se pudo generar el embedding: gateway.'] }),
    ]
    fakeApi({
      'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }),
      'PATCH /api/places/uuid-1 dry': () => jsonResponse({ plan: plan() }),
      'PATCH /api/places/uuid-1': () => saves.shift()!(),
    })
    const props = renderDialog()
    const user = userEvent.setup()
    const name = await screen.findByLabelText('Nombre')

    await user.clear(name)
    await user.type(name, 'Palenque')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('No existe el perfil @noexiste (o es privado). No se guardó nada.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Guardado, con avisos')).toBeTruthy()
    expect(screen.getByText('Se guardó, pero no se pudo generar el embedding: gateway.')).toBeTruthy()
    expect(props.onSaved).toHaveBeenCalledTimes(1)
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('sube un logo, muestra su costo y lo guarda con la edición', async () => {
    const logo = { key: 'logos/place-1-0123abcd.webp', kind: 'logo', bgColor: '#ffffff', color: '#000000', source: 'manual', fetchedAt: '2026-10-21T12:00:00.000Z' }
    const { fetchMock, bodies } = fakeApi({
      'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }),
      'POST /api/places/uuid-1/logo': () => jsonResponse({ logo, logoUrl: 'https://logos.example/logos/place-1-0123abcd.webp', classificationUsd: 0.00016 }),
      'PATCH /api/places/uuid-1 dry': () => jsonResponse({ plan: plan({ changed: ['logo'] }) }),
      'PATCH /api/places/uuid-1': () => jsonResponse({ place: detail(), warnings: [] }),
    })
    renderDialog()
    const user = userEvent.setup()
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })

    await user.upload(await screen.findByLabelText('Subir logo'), file)

    expect(await screen.findByText('Subido (clasificación ≈ US$ 0.000160); se guarda con el lugar.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledWith('/api/places/uuid-1/logo', expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'image/png' }, body: file }))
    expect(screen.getByRole('img', { name: 'Logo de El Palenque' })).toHaveAttribute('src', 'https://logos.example/logos/place-1-0123abcd.webp')
    await user.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(bodies('PATCH /api/places/uuid-1')).toEqual([{ edit: { logo }, confirmSharedInstagram: false }]))
  })

  it('un logo que no sirve muestra el motivo', async () => {
    fakeApi({
      'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }),
      'POST /api/places/uuid-1/logo': () => jsonResponse({ error: { code: 'LOGO_INVALID', message: 'No se pudo usar el logo: la imagen mide menos de 150 px.' } }, 422),
    })
    renderDialog()

    await userEvent.setup().upload(await screen.findByLabelText('Subir logo'), new File([new Uint8Array([1])], 'chico.png', { type: 'image/png' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo usar el logo: la imagen mide menos de 150 px.')
  })

  it('elimina con confirmación', async () => {
    const { fetchMock } = fakeApi({
      'GET /api/places/uuid-1': () => jsonResponse({ place: detail() }),
      'DELETE /api/places/uuid-1': () => jsonResponse({ id: 'uuid-1', snapshot: null, brandKeys: [], logoKey: null, warnings: [] }),
    })
    const props = renderDialog()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Eliminar lugar' }))
    expect(screen.getByText('¿Eliminar El Palenque? No se puede deshacer.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/places/uuid-1', expect.objectContaining({ method: 'DELETE' }))
    await user.click(screen.getByRole('button', { name: 'Sí, eliminar' }))

    await waitFor(() => expect(props.onDeleted).toHaveBeenCalledWith('uuid-1'))
  })
})
