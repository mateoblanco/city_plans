import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscountLink, DiscountPlace, DiscountRun, DiscountRunProgress, StoredBenefit } from '@/types/discounts'
import type { PlaceListItem } from '@/types/places'
import { DiscountsPage, POLL_MS } from './discounts-page'

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const benefit = (patch: Partial<StoredBenefit> = {}): StoredBenefit => ({
  id: `b-${Math.random()}`, percent: 20, cardType: 'debit', cardTiers: [], cardProgram: null, days: 'all', daysText: null, mode: 'mixed', instantPercent: 10, refundPercent: 10,
  cap: { text: '4000 pesos uruguayos por cierre de estado de cuenta', amount: 4000, currency: 'UYU', period: 'statement' },
  validFrom: '2026-11-01', validTo: '2027-10-31', conditions: 'Beneficio no acumulable a otras ofertas.', sourceText: '20% Off con Tarjetas de Débito', parsedBy: 'html',
  firstSeenAt: '2026-11-05T12:00:00.000Z', lastSeenAt: '2026-11-05T12:00:00.000Z', active: true, expired: false, ...patch,
})

const link = (placeId: string, name: string, patch: Partial<DiscountLink> = {}): DiscountLink => ({
  placeId, name, neighborhoodId: 'POCITOS', origin: 'auto', wholeBrand: false, score: 0.9, reasons: ['mismo nombre'], locationIndex: null, ...patch,
})

const place = (id: string, patch: Partial<DiscountPlace> = {}): DiscountPlace => ({
  id: `bbva:${id.toLowerCase().replace(/\s+/g, '-')}`, providerId: 'bbva', sourceName: id, category: 'Restaurante', city: 'Pocitos, Montevideo', departments: ['Montevideo'], montevideo: true, locations: [],
  website: null, instagram: null, sourceUrl: `https://www.bbva.com.uy/${id}.html`, logoUrl: null, description: null, sourceTags: [],
  campaign: { validFrom: '2026-11-01', validTo: '2027-10-31', text: null },
  benefits: [benefit(), benefit({ cardType: 'credit' }), benefit({ cardType: 'credit', percent: 30, refundPercent: 20 })],
  match: { status: 'missing', origin: 'auto', links: [], candidates: [], missingBranches: 0, nearby: [] },
  firstSeenAt: '2026-11-05T12:00:00.000Z', lastSeenAt: '2026-11-05T12:00:00.000Z', active: true, ignored: false, matchedAt: null, ...patch,
})

const run: DiscountRun = {
  id: 'r1', startedAt: '2026-11-05T12:00:00.000Z', finishedAt: '2026-11-05T12:03:00.000Z', reparsedFrom: null,
  providers: [{ providerId: 'bbva', name: 'BBVA', kind: 'bank', status: 'ok', places: 4, requests: 90, llm: { calls: 0, costUsd: 0 } }],
  errors: [], warnings: [],
}

const ourChelato = '00000000-0000-4000-8000-000000000003'
const ourKamba = '00000000-0000-4000-8000-000000000004'

const initialPlaces = () => [
  place('Porterhouse'),
  place('Es Mercat', { match: { status: 'found', origin: 'auto', links: [link('00000000-0000-4000-8000-000000000001', 'Es Mercat')], candidates: [], missingBranches: 0, nearby: [] } }),
  place('Chelato', { match: { status: 'doubtful', origin: 'auto', links: [], candidates: [{ placeId: ourChelato, name: 'Chelato', neighborhoodId: 'CARRASCO', brandKey: 'chelato', score: 0.9, reasons: ['mismo nombre'] }], missingBranches: 0, nearby: [] } }),
  place('Bocatti', { match: { status: 'found', origin: 'auto', links: [link('00000000-0000-4000-8000-000000000005', 'Bocatti', { wholeBrand: true }), link('00000000-0000-4000-8000-000000000006', 'Bocatti', { wholeBrand: true, neighborhoodId: 'CENTRO' })], candidates: [], missingBranches: 0, nearby: [] } }),
  place('Up Lavista', { city: 'Atlantida', departments: ['Canelones'], montevideo: false, match: { status: 'not_matched', origin: 'auto', links: [], candidates: [], missingBranches: 0, nearby: [] } }),
  place('Cerrado', { active: false }),
  place('Vencido', { benefits: [benefit({ expired: true })] }),
  place('Ignorado', { ignored: true }),
]

type ServerOptions = { places?: DiscountPlace[] | 'fail'; run?: DiscountRun | null; progress?: DiscountRunProgress[]; start?: 'busy'; failActions?: boolean; search?: PlaceListItem[] }

/** Servidor de mentira: lo guardado, las acciones del cruce (que cambian su estado) y la búsqueda de lugares. */
function server(options: ServerOptions = {}) {
  let places = options.places === 'fail' ? 'fail' as const : options.places ?? initialPlaces()
  const progress = [...(options.progress ?? [{ status: 'idle' }])]
  const calls: { url: string; method: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: input, method, body })
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/discounts') {
      if (places === 'fail') return json({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudieron leer los descuentos.' } }, 500)
      return json({ run: options.run === undefined ? run : options.run, places })
    }
    if (url.pathname === '/api/discounts/runs/current') return json(progress.length > 1 ? progress.shift() : progress[0])
    if (url.pathname === '/api/discounts/runs' && method === 'POST') {
      if (options.start === 'busy') return json({ error: { code: 'DISCOUNT_RUN_IN_PROGRESS', message: 'Ya hay una actualización de descuentos en curso.' } }, 409)
      return json({ runId: 'r2' }, 202)
    }
    if (url.pathname === '/api/places') {
      const q = url.searchParams.get('q') ?? ''
      const found = (options.search ?? []).filter((item) => item.name.toLowerCase().includes(q.toLowerCase()))
      return json({ places: found, total: found.length, counts: { all: found.length, published: found.length, review: 0 } })
    }
    const action = url.pathname.match(/^\/api\/discounts\/places\/([^/]+)\/(confirm|links|ignored|auto)$/)
    if (action && places !== 'fail') {
      if (options.failActions) return json({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo guardar el cruce.' } }, 500)
      const id = decodeURIComponent(action[1])
      const current = places.find((item) => item.id === id)!
      let next: DiscountPlace = current
      if (action[2] === 'confirm') next = { ...current, match: { ...current.match, origin: 'manual', links: current.match.links.map((item) => ({ ...item, origin: 'manual' })) } }
      if (action[2] === 'ignored') next = { ...current, ignored: (body as { ignored: boolean }).ignored }
      if (action[2] === 'links') {
        const requested = (body as { links: { placeId: string; wholeBrand: boolean }[] }).links
        next = { ...current, match: { ...current.match, origin: 'manual', status: requested.length ? 'found' : 'missing', links: requested.map((item) => link(item.placeId, item.placeId === ourKamba ? 'Kamba' : item.placeId === ourChelato ? 'Chelato' : 'Lugar', { origin: 'manual', wholeBrand: item.wholeBrand })) } }
      }
      if (action[2] === 'auto') next = { ...current, match: { ...current.match, origin: 'auto' } }
      places = places.map((item) => (item.id === id ? next : item))
      return json({ place: next })
    }
    return json({ error: { code: 'NOT_FOUND_ERROR', message: input } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    calls,
    setPlaces: (value: DiscountPlace[]) => { places = value },
  }
}

// hidden: también detrás del diálogo abierto.
const row = (name: string) => screen.getByRole('button', { name, hidden: true }).closest('tr')!

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DiscountsPage', () => {
  it('estado inicial sin descuentos', async () => {
    server({ places: [], run: null })
    render(<DiscountsPage />)
    expect(screen.getByLabelText('Cargando descuentos')).toBeInTheDocument()
    expect(await screen.findByText('Todavía no hay descuentos')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Actualizar descuentos' })).toBeEnabled()
  })

  it('resumen y tabla: Montevideo, sin inactivos, vencidos ni ignorados por defecto; origen y "toda la marca"', async () => {
    server()
    render(<DiscountsPage />)
    expect(await screen.findByText('Porterhouse')).toBeInTheDocument()
    // El resumen cierra con la tabla (sólo Montevideo) y abajo da los totales.
    const tile = (label: string) => within(screen.getByText('Lugares').closest('dl')!).getByText(label).nextSibling
    expect(tile('Lugares')).toHaveTextContent('4')
    expect(tile('Encontrados')).toHaveTextContent('2')
    expect(tile('No están en la base')).toHaveTextContent('1')
    expect(tile('Fuera de Montevideo')).toHaveTextContent('0')
    expect(screen.getByText(/En total: 4 de Montevideo · 1 fuera · 2 inactivos · 1 ignorado/)).toBeInTheDocument()
    expect(screen.getByText('4 lugares')).toBeInTheDocument()
    for (const hidden of ['Up Lavista', 'Cerrado', 'Vencido', 'Ignorado']) expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    expect(within(row('Bocatti')).getByText('Toda la marca')).toBeInTheDocument()
    expect(within(row('Bocatti')).getByText('Auto')).toBeInTheDocument()
    expect(within(row('Bocatti')).getByText(/y 1 más/)).toBeInTheDocument()
    expect(within(row('Chelato')).getByText(/¿Chelato\?/)).toBeInTheDocument()
  })

  it('filtros: inactivos, ignorados, origen, ciudad y vacío por filtros', async () => {
    server()
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    await user.click(screen.getByLabelText('Mostrar inactivos'))
    expect(screen.getByText('Cerrado')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(within(row('Cerrado')).getByText('Inactivo')).toBeInTheDocument()
    await user.click(screen.getByLabelText('Mostrar ignorados'))
    expect(within(row('Ignorado')).getAllByText('Ignorado')).toHaveLength(2)
    await user.selectOptions(screen.getByLabelText('Origen'), 'manual')
    expect(screen.getByText('Ningún lugar coincide con los filtros')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    await user.selectOptions(screen.getByLabelText('Ciudad'), 'outside')
    expect(screen.getByText('Up Lavista')).toBeInTheDocument()
    // El resumen sigue a los filtros.
    expect(within(screen.getByText('Lugares').closest('dl')!).getByText('Lugares').nextSibling).toHaveTextContent('1')
    expect(within(screen.getByText('Lugares').closest('dl')!).getByText('Fuera de Montevideo').nextSibling).toHaveTextContent('1')
  })

  it('confirmar en la fila pasa el cruce a manual sin recargar todo', async () => {
    const fake = server()
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByRole('button', { name: 'Es Mercat' })
    expect(within(row('Porterhouse')).queryByRole('button', { name: /Confirmar/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirmar cruce de Es Mercat' }))
    expect(await within(row('Es Mercat')).findByText('Manual')).toBeInTheDocument()
    expect(within(row('Es Mercat')).getByText('Guardado')).toBeInTheDocument()
    expect(within(row('Es Mercat')).queryByRole('button', { name: /Confirmar/ })).not.toBeInTheDocument()
    expect(fake.calls.filter((call) => call.url === '/api/discounts')).toHaveLength(1)
  })

  it('ignorar en la fila: desaparece; con "Mostrar ignorados" se puede dejar de ignorar', async () => {
    server()
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    await user.click(screen.getByRole('button', { name: 'Ignorar Porterhouse' }))
    await waitFor(() => expect(screen.queryByText('Porterhouse')).not.toBeInTheDocument())
    await user.click(screen.getByLabelText('Mostrar ignorados'))
    await user.click(screen.getByRole('button', { name: 'Dejar de ignorar Porterhouse' }))
    await waitFor(() => expect(within(row('Porterhouse')).queryByText('Ignorado')).not.toBeInTheDocument())
  })

  it('un error en una acción de la fila se muestra en la fila', async () => {
    server({ failActions: true })
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByRole('button', { name: 'Es Mercat' })
    await user.click(screen.getByRole('button', { name: 'Confirmar cruce de Es Mercat' }))
    expect(await within(row('Es Mercat')).findByRole('alert')).toHaveTextContent('No se pudo guardar el cruce.')
  })

  it('corregir: elegir un candidato', async () => {
    const fake = server()
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByRole('button', { name: 'Chelato' })
    await user.click(screen.getByRole('button', { name: 'Corregir cruce de Chelato' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('checkbox', { name: /Chelato · Carrasco/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Vincular seleccionados (1)' }))
    expect(await within(dialog).findByRole('button', { name: 'Desvincular Chelato' })).toBeInTheDocument()
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PUT', body: { links: [{ placeId: ourChelato, wholeBrand: false }] } })
    expect(within(row('Chelato')).getByText('Manual')).toBeInTheDocument()
  })

  it('corregir: buscar un lugar nuestro y vincularlo como toda la marca; desvincular', async () => {
    const fake = server({ search: [{ id: ourKamba, name: 'Kamba', neighborhoodId: 'PALERMO' } as PlaceListItem] })
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    await user.click(screen.getByRole('button', { name: 'Corregir cruce de Porterhouse' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByLabelText(/toda la marca/))
    await user.type(within(dialog).getByPlaceholderText('Buscar un lugar nuestro por nombre'), 'kam')
    await user.click(await within(dialog).findByRole('button', { name: 'Vincular Kamba' }))
    expect(await within(dialog).findByRole('button', { name: 'Desvincular Kamba' })).toBeInTheDocument()
    expect(fake.calls.find((call) => call.url.startsWith('/api/places?'))?.url).toContain('q=kam')
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PUT', body: { links: [{ placeId: ourKamba, wholeBrand: true }] } })
    await user.click(within(dialog).getByRole('button', { name: 'Desvincular Kamba' }))
    expect(await within(dialog).findByText('Ninguno.')).toBeInTheDocument()
    expect(fake.calls.at(-1)).toMatchObject({ method: 'PUT', body: { links: [] } })
    // Manual: se puede volver a automático.
    await user.click(within(dialog).getByRole('button', { name: 'Volver a automático' }))
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'Volver a automático' })).not.toBeInTheDocument())
  })

  it('el detalle muestra el tope estructurado y los beneficios inactivos', async () => {
    server({ places: [place('Lo de Tere', { benefits: [benefit(), benefit({ cardType: 'credit', active: false })] })] })
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await user.click(await screen.findByRole('button', { name: 'Lo de Tere' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('4.000 UYU por cierre')).toHaveLength(2)
    expect(within(dialog).getByText('Inactivo')).toBeInTheDocument()
  })

  it('actualizar: progreso y recarga al terminar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const fake = server({
      progress: [
        { status: 'idle' },
        { status: 'running', runId: 'r2', startedAt: '2026-11-05T13:00:00.000Z', providerId: 'bbva', phase: 'details', done: 34, total: 83 },
        { status: 'done', runId: 'r2', finishedAt: '2026-11-05T13:03:00.000Z' },
      ],
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    fake.setPlaces([place('Nuevo')])
    await user.click(screen.getByRole('button', { name: 'Actualizar descuentos' }))
    expect(screen.getByRole('button', { name: 'Actualizando…' })).toBeDisabled()
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS) })
    expect(await screen.findByText(/detalle 34 de 83/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS) })
    expect(await screen.findByText('Nuevo')).toBeInTheDocument()
  })

  it('una corrida que falla muestra el error y deja lo guardado', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    server({
      progress: [
        { status: 'running', runId: 'r2', startedAt: '2026-11-05T13:00:00.000Z', providerId: 'bbva', phase: 'listing', done: 0, total: null },
        { status: 'error', runId: 'r2', finishedAt: '2026-11-05T13:00:10.000Z', message: 'El listado no tiene cards de descuentos: cambió la estructura de la página.' },
      ],
    })
    render(<DiscountsPage />)
    expect(await screen.findByText(/Actualizando descuentos/)).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS) })
    expect(await screen.findByText(/cambió la estructura de la página/)).toBeInTheDocument()
    expect(screen.getByText(/Lo guardado no se tocó/)).toBeInTheDocument()
    expect(screen.getByText('Porterhouse')).toBeInTheDocument()
  })

  it('409 si ya hay una corrida', async () => {
    server({ start: 'busy' })
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    await user.click(screen.getByRole('button', { name: 'Actualizar descuentos' }))
    expect(await screen.findByText(/Ya hay una actualización de descuentos en curso\./)).toBeInTheDocument()
  })

  it('error inicial con reintento', async () => {
    const fake = server({ places: 'fail' })
    const user = userEvent.setup()
    render(<DiscountsPage />)
    expect(await screen.findByText('No se pudieron cargar los descuentos')).toBeInTheDocument()
    fake.setPlaces(initialPlaces())
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Porterhouse')).toBeInTheDocument()
  })

  it('vecino con otro nombre: nota en la fila, sin cambiar el estado', async () => {
    server({ places: [place('Nora Rey', { match: { status: 'missing', origin: 'auto', links: [], candidates: [], missingBranches: 0, nearby: [
      { placeId: '00000000-0000-4000-8000-000000000008', name: 'El Horno de Juan', neighborhoodId: 'POCITOS', meters: 3, address: 'Blvr. 26 de Marzo 1153' },
      { placeId: '00000000-0000-4000-8000-000000000009', name: 'Casa Fermento', neighborhoodId: 'POCITOS', meters: 91, address: 'Blvr. 26 de Marzo 1153' },
    ] } })] })
    render(<DiscountsPage />)
    const note = await within(await screen.findByRole('table')).findByText('cerca de El Horno de Juan, a 3 m y 1 más')
    expect(note).toHaveAttribute('title', 'El Horno de Juan, a 3 m de Blvr. 26 de Marzo 1153\nCasa Fermento, a 91 m de Blvr. 26 de Marzo 1153')
    expect(within(row('Nora Rey')).getByText('No está en la base')).toBeInTheDocument()
  })

  it('cadena encontrada en parte: marca "Faltan sucursales en la base"', async () => {
    server({ places: [place('Burger Time', { match: { status: 'found', origin: 'auto', links: [link('00000000-0000-4000-8000-000000000007', 'Burger Time', { locationIndex: 0 })], candidates: [], missingBranches: 5, nearby: [] } })] })
    render(<DiscountsPage />)
    expect(await within(await screen.findByRole('table')).findByText('Faltan sucursales en la base (5)')).toBeInTheDocument()
    expect(within(row('Burger Time')).getByText('Encontrado')).toBeInTheDocument()
  })

  it('notas de la corrida (no son avisos) y el tope en el tooltip de los beneficios', async () => {
    server({
      run: { ...run, providers: [...run.providers, { providerId: 'santander', name: 'Santander', kind: 'bank', status: 'ok', places: 48, requests: 58, llm: { calls: 0, costUsd: 0 }, notes: ['Sólo canje de puntos, sin porcentaje (no se guardan): 2 — Bequelo, Donut City.'] }] },
      places: [place('Almar', { providerId: 'santander', benefits: [benefit({ cardType: 'credit', percent: 25, cap: { text: 'Private Banking hasta UYU 6.000, Select UYU 4.000, resto UYU 2.000 por mes', amount: null, currency: 'UYU', period: 'month' } })] })],
    })
    render(<DiscountsPage />)
    expect(await screen.findByText('Notas de la corrida (1)')).toBeInTheDocument()
    expect(screen.getByText(/Santander: Sólo canje de puntos/)).toBeInTheDocument()
    expect(screen.queryByText(/aviso/)).not.toBeInTheDocument()
    expect(screen.getByText('Crédito 25%').closest('td')).toHaveAttribute('title', 'Crédito 25%: tope Private Banking hasta UYU 6.000, Select UYU 4.000, resto UYU 2.000 por mes')
  })

  it('error parcial de la corrida: avisa qué páginas no se pudieron leer', async () => {
    server({ run: { ...run, errors: [{ providerId: 'bbva', url: 'https://www.bbva.com.uy/roto.html', message: 'respondió 404.' }], warnings: ['Marmatu: sin párrafo legal'] } })
    render(<DiscountsPage />)
    expect(await screen.findByText('1 página no se pudo leer · 1 aviso')).toBeInTheDocument()
  })
})
