import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscountLink, DiscountPlace, DiscountRun, DiscountRunProgress, GoogleCandidatesResponse, OurPlaceOption, PlaceSearchJobRow, PlaceSearchProgress, StoredBenefit, StoredPlaceSearch } from '@/types/discounts'
import type { PlaceListItem } from '@/types/places'
import { missingRows } from '../../server/discounts/missing.ts'
import { SEARCH_POLL_MS } from '@/components/discount-missing-view'
import { DiscountsPage, POLL_MS } from './discounts-page'

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

const benefit = (patch: Partial<StoredBenefit> = {}): StoredBenefit => ({
  id: `b-${Math.random()}`, percent: 20, cardType: 'debit', cardTiers: [], cardProgram: null, days: 'all', daysText: null, mode: 'mixed', instantPercent: 10, refundPercent: 10,
  cap: { text: '4000 pesos uruguayos por cierre de estado de cuenta', amount: 4000, currency: 'UYU', period: 'statement' },
  validFrom: '2026-11-01', validTo: '2027-10-31', conditions: 'Beneficio no acumulable a otras ofertas.', sourceText: '20% Off con Tarjetas de Débito', sourceUrl: null, parsedBy: 'html',
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
  firstSeenAt: '2026-11-05T12:00:00.000Z', lastSeenAt: '2026-11-05T12:00:00.000Z', active: true, ignored: false, discard: null, matchedAt: null, ...patch,
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
  // Vencido de verdad: la fecha pasó y dejó de aparecer.
  place('Vencido', { benefits: [benefit({ expired: true, active: false })] }),
  place('Ignorado', { ignored: true }),
]

type ServerOptions = {
  places?: DiscountPlace[] | 'fail'; run?: DiscountRun | null; progress?: DiscountRunProgress[]; start?: 'busy'; failActions?: boolean; search?: PlaceListItem[]
  /** Búsqueda en Google de los que no están en la base. */
  searches?: Record<string, StoredPlaceSearch[]>; searchProgress?: PlaceSearchProgress[]
  /** Panel «Resolver»: nuestros lugares, sugerencias, Google y lo que devuelve "Ninguno"/"Agregar". */
  ours?: OurPlaceOption[]; suggestions?: OurPlaceOption[]; google?: GoogleCandidatesResponse; candidates?: GoogleCandidatesResponse
  pickSearches?: Record<string, StoredPlaceSearch[]>
}

/** Servidor de mentira: lo guardado, las acciones del cruce (que cambian su estado) y la búsqueda de lugares. */
function server(options: ServerOptions = {}) {
  let places = options.places === 'fail' ? 'fail' as const : options.places ?? initialPlaces()
  const progress = [...(options.progress ?? [{ status: 'idle' }])]
  let searches = options.searches ?? {}
  const searchProgress = [...(options.searchProgress ?? [{ status: 'idle' }])]
  const calls: { url: string; method: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: input, method, body })
    const url = new URL(input, 'http://localhost')
    if (url.pathname === '/api/discounts') {
      if (places === 'fail') return json({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudieron leer los descuentos.' } }, 500)
      return json({ run: options.run === undefined ? run : options.run, places, searches, missing: missingRows(places) })
    }
    if (url.pathname === '/api/discounts/runs/current') return json(progress.length > 1 ? progress.shift() : progress[0])
    if (url.pathname === '/api/discounts/runs' && method === 'POST') {
      if (options.start === 'busy') return json({ error: { code: 'DISCOUNT_RUN_IN_PROGRESS', message: 'Ya hay una actualización de descuentos en curso.' } }, 409)
      return json({ runId: 'r2' }, 202)
    }
    if (url.pathname === '/api/discounts/searches/current') return json(searchProgress.length > 1 ? searchProgress.shift() : searchProgress[0])
    if (url.pathname === '/api/discounts/searches/estimate') return json({ searchUsd: 0.032, extractionUsd: 0.075, basedOnPlaces: 214, basedOnReports: 10 })
    if (url.pathname === '/api/discounts/searches' && method === 'POST') return json({ jobId: 'j1' }, 202)
    if (url.pathname === '/api/discounts/searches/pick' && method === 'POST') return json({ ok: true, searches: options.pickSearches ?? {} })
    if (url.pathname === '/api/places') {
      const q = url.searchParams.get('q') ?? ''
      const found = (options.search ?? []).filter((item) => item.name.toLowerCase().includes(q.toLowerCase()))
      return json({ places: found, total: found.length, counts: { all: found.length, published: found.length, review: 0 } })
    }
    if (url.pathname === '/api/discounts/places/ignored' && method === 'POST' && places !== 'fail') {
      const { ids, ignored } = body as { ids: string[]; ignored: boolean }
      places = places.map((item) => (ids.includes(item.id) ? { ...item, ignored, discard: { origin: 'manual' as const, reason: null } } : item))
      return json({ places: places.filter((item) => ids.includes(item.id)) })
    }
    if (url.pathname === '/api/discounts/our-places') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase()
      return json({ places: (options.ours ?? []).filter((item) => item.name.toLowerCase().includes(q) || item.instagram?.includes(q)) })
    }
    if (url.pathname === '/api/discounts/our-places/suggestions') return json({ places: options.suggestions ?? [] })
    if (url.pathname === '/api/discounts/searches/google' && method === 'POST') return json(options.google ?? { results: [], costUsd: 0.032, searches: {} })
    if (url.pathname === '/api/discounts/searches/candidates' && method === 'POST') return json(options.candidates ?? { results: [], costUsd: 0, searches: {} })
    const action = url.pathname.match(/^\/api\/discounts\/places\/([^/]+)\/(confirm|links|ignored|auto)$/)
    if (action && places !== 'fail') {
      if (options.failActions) return json({ error: { code: 'UNKNOWN_ERROR', message: 'No se pudo guardar el cruce.' } }, 500)
      const id = decodeURIComponent(action[1])
      const current = places.find((item) => item.id === id)!
      let next: DiscountPlace = current
      if (action[2] === 'confirm') next = { ...current, match: { ...current.match, origin: 'manual', links: current.match.links.map((item) => ({ ...item, origin: 'manual' })) } }
      if (action[2] === 'ignored') next = { ...current, ignored: (body as { ignored: boolean }).ignored, discard: { origin: 'manual', reason: null } }
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
    setSearches: (value: Record<string, StoredPlaceSearch[]>) => { searches = value },
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

  it('resumen y tabla: Montevideo, sin inactivos, vencidos ni descartados por defecto; origen y "toda la marca"', async () => {
    server()
    render(<DiscountsPage />)
    expect(await screen.findByText('Porterhouse')).toBeInTheDocument()
    // El resumen cierra con la tabla (sólo Montevideo) y abajo da los totales.
    const tile = (label: string) => within(screen.getByText('Lugares').closest('dl')!).getByText(label).nextSibling
    expect(tile('Lugares')).toHaveTextContent('4')
    expect(tile('Encontrados')).toHaveTextContent('2')
    expect(tile('No están en la base')).toHaveTextContent('1')
    expect(tile('Fuera de Montevideo')).toHaveTextContent('0')
    expect(screen.getByText(/En total: 4 de Montevideo · 1 fuera · 2 inactivos · 1 descartado/)).toBeInTheDocument()
    expect(screen.getByText(/^4 lugares ·/)).toBeInTheDocument()
    for (const hidden of ['Up Lavista', 'Cerrado', 'Vencido', 'Ignorado']) expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    expect(within(row('Bocatti')).getByText('Toda la marca')).toBeInTheDocument()
    expect(within(row('Bocatti')).getByText('Auto')).toBeInTheDocument()
    expect(within(row('Bocatti')).getByText(/y 1 más/)).toBeInTheDocument()
    expect(within(row('Chelato')).getByText(/¿Chelato\?/)).toBeInTheDocument()
  })

  it('filtros: inactivos, descartados, origen, ciudad y vacío por filtros', async () => {
    server()
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    await user.click(screen.getByLabelText('Mostrar inactivos'))
    expect(screen.getByText('Cerrado')).toBeInTheDocument()
    expect(screen.getByText('Vencido')).toBeInTheDocument()
    expect(within(row('Cerrado')).getByText('Inactivo')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Descartados'), 'show')
    expect(within(row('Ignorado')).getByText('Descartado')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Descartados'), 'only')
    expect(screen.queryByText('Porterhouse')).not.toBeInTheDocument()
    expect(screen.getByText('Ignorado')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Descartados'), 'hide')
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

  it('descartar en la fila: desaparece; con "Sólo descartados" se puede volver a mostrar', async () => {
    server()
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    await user.click(screen.getByRole('button', { name: 'Descartar Porterhouse' }))
    await waitFor(() => expect(screen.queryByText('Porterhouse')).not.toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Descartados'), 'only')
    expect(within(row('Porterhouse')).getByText('Descartado')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Volver a mostrar Porterhouse' }))
    await waitFor(() => expect(screen.queryByText('Porterhouse')).not.toBeInTheDocument())
    await user.selectOptions(screen.getByLabelText('Descartados'), 'hide')
    expect(within(row('Porterhouse')).queryByText('Descartado')).not.toBeInTheDocument()
  })

  it('descartados automáticos: muestran el rubro; masivo: descartar y volver a mostrar seleccionados', async () => {
    const fake = server({ places: [...initialPlaces(), place('Carnes del Sur', { ignored: true, discard: { origin: 'auto', reason: 'Rubro: Carnicería' } })] })
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await screen.findByText('Porterhouse')
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Porterhouse' }))
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Chelato' }))
    await user.click(screen.getByRole('button', { name: 'Descartar seleccionados (2)' }))
    await waitFor(() => expect(screen.queryByText('Porterhouse')).not.toBeInTheDocument())
    expect(screen.queryByText('Chelato')).not.toBeInTheDocument()
    expect(fake.calls.at(-1)).toMatchObject({ url: '/api/discounts/places/ignored', method: 'POST', body: { ids: ['bbva:porterhouse', 'bbva:chelato'], ignored: true } })
    await user.selectOptions(screen.getByLabelText('Descartados'), 'only')
    expect(within(row('Carnes del Sur')).getByText('Descartado · Rubro: Carnicería')).toBeInTheDocument()
    expect(within(row('Porterhouse')).getByText('Descartado')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Carnes del Sur' }))
    await user.click(screen.getByRole('button', { name: 'Volver a mostrar seleccionados (1)' }))
    await waitFor(() => expect(screen.queryByText('Carnes del Sur')).not.toBeInTheDocument())
    expect(fake.calls.at(-1)).toMatchObject({ body: { ids: ['bbva:carnes-del-sur'], ignored: false } })
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

  it('fecha vencida pero publicado: vigente, con "Vigencia desactualizada en la fuente" en la fila y en el diálogo, y la página de origen', async () => {
    server({ places: [place('La Perdiz', { benefits: [benefit({ expired: true, validTo: '2026-09-30', sourceUrl: 'https://www.itau.com.uy/inst/restaurantesplatinum.html' })] })] })
    const user = userEvent.setup()
    render(<DiscountsPage />)
    await user.click(await screen.findByRole('button', { name: 'La Perdiz' }))
    expect(within(row('La Perdiz')).getByText('Vigencia desactualizada en la fuente')).toBeInTheDocument()
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Vigencia desactualizada en la fuente')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'restaurantesplatinum.html' })).toHaveAttribute('href', 'https://www.itau.com.uy/inst/restaurantesplatinum.html')
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

  describe('No están en la base', () => {
    const POCITOS = { lat: -34.9115, lng: -56.153 }
    const missingPlaces = () => [
      place('La Pasiva'),
      place('La Pasiva Santander', { id: 'santander:la-pasiva', providerId: 'santander', sourceName: 'La Pasiva', city: null, locations: [{ address: 'Av. Brasil 2580', area: null, department: null, mapsUrl: null, coordinates: POCITOS }] }),
      place('Kamba', { id: 'itau:montevideo:kamba', providerId: 'itau', city: 'Montevideo' }),
      place('Chivitos', { city: 'Centro, Montevideo' }),
      place('Ya Buscado', { city: 'Centro, Montevideo' }),
      place('Es Mercat', { match: { status: 'found', origin: 'auto', links: [link('00000000-0000-4000-8000-000000000001', 'Es Mercat')], candidates: [], missingBranches: 0, nearby: [] } }),
    ]
    const search = (patch: Partial<StoredPlaceSearch>): StoredPlaceSearch => ({
      locationIndex: null, status: 'not_found', searchedAt: '2026-11-09T12:00:00.000Z', googlePlaceId: null, location: null, candidates: [], placeId: null, error: null, ourPlace: null, ...patch,
    })
    const pasivaKey = 'bbva:la-pasiva#x|santander:la-pasiva#0'
    const missingRow = (label: string) => screen.getByRole('checkbox', { name: `Seleccionar ${label}`, hidden: true }).closest('tr')!
    const showMissing = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByText('Chivitos')
      await user.selectOptions(screen.getByLabelText('Cruce'), 'missing')
    }
    const job = (patch: Partial<Extract<PlaceSearchProgress, { status: 'running' | 'done' }>>): PlaceSearchProgress => ({
      status: 'done', jobId: 'j1', startedAt: '2026-11-10T12:00:00.000Z', finishedAt: '2026-11-10T12:05:00.000Z', rows: [], searches: 0, costUsd: 0, stopped: null, candidateDetails: {}, ...patch,
    })
    const jobRow = (rowKey: string, name: string, patch: Partial<PlaceSearchJobRow> = {}): PlaceSearchJobRow => ({
      rowKey, name, neighborhoodId: null, providerIds: ['bbva'], state: 'done', outcome: 'review', candidates: [], candidateMeters: {}, googlePlaceId: null, ourPlace: null, error: null, costUsd: 0.1, ...patch,
    })

    it('agrupa por barrio (Sin barrio al final), junta proveedores, muestra el estado guardado y selecciona por barrio salteando los ya buscados', async () => {
      server({ places: missingPlaces(), searches: { 'bbva:ya-buscado': [search({ status: 'exists', ourPlace: { id: 'u1', name: 'Ya Buscado', status: 'published' } })] } })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)

      expect(screen.getByText(/4 lugares sin repetir · 3 barrios · 0 seleccionados/)).toBeInTheDocument()
      const headers = screen.getAllByRole('checkbox', { name: /^Seleccionar todo / }).map((box) => box.getAttribute('aria-label'))
      expect(headers).toEqual(['Seleccionar todo Centro', 'Seleccionar todo Pocitos', 'Seleccionar todo Sin barrio'])
      // Una sola fila de La Pasiva con los dos proveedores.
      expect(screen.getAllByText('La Pasiva')).toHaveLength(1)
      const pasiva = missingRow('La Pasiva (Pocitos)')
      expect(within(pasiva).getByText('BBVA')).toBeInTheDocument()
      expect(within(pasiva).getByText('SANTANDER')).toBeInTheDocument()
      expect(within(pasiva).getByText('Av. Brasil 2580')).toBeInTheDocument()
      expect(within(missingRow('Ya Buscado (Centro)')).getByText('Ya existe · publicado')).toBeInTheDocument()
      expect(screen.queryByText('Es Mercat')).not.toBeInTheDocument()

      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar todo Centro' }))
      expect(screen.getByRole('checkbox', { name: 'Seleccionar Chivitos (Centro)' })).toBeChecked()
      expect(screen.getByRole('checkbox', { name: 'Seleccionar Ya Buscado (Centro)' })).not.toBeChecked()
      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Kamba' }))
      expect(screen.getByText(/2 seleccionados/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Buscar seleccionados (2)' })).toBeEnabled()
    })

    it('el filtro de proveedor muestra la fila unida sin cambiar su clave', async () => {
      const fake = server({ places: missingPlaces() })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)
      await user.selectOptions(screen.getByLabelText('Proveedor'), 'santander')
      expect(screen.getByText(/1 lugar sin repetir/)).toBeInTheDocument()
      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar La Pasiva (Pocitos)' }))
      await user.click(screen.getByRole('button', { name: 'Buscar seleccionados (1)' }))
      await user.click(await screen.findByRole('button', { name: 'Buscar' }))
      await waitFor(() => expect(fake.calls.find((call) => call.url === '/api/discounts/searches')?.body).toEqual({ rows: [pasivaKey] }))
    })

    it('confirmar muestra el costo estimado; al buscar consulta el progreso y al terminar recarga y muestra el resumen', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const running = job({ status: 'running', finishedAt: null, rows: [jobRow('bbva:chivitos#x', 'Chivitos', { state: 'searching', outcome: null }), jobRow('itau:montevideo:kamba#x', 'Kamba', { state: 'queued', outcome: null })] })
      const done = job({ searches: 2, costUsd: 0.139, rows: [jobRow('bbva:chivitos#x', 'Chivitos'), jobRow('itau:montevideo:kamba#x', 'Kamba', { outcome: 'exists', ourPlace: { id: 'u1', name: 'Kamba', status: 'review' } })] })
      const fake = server({ places: missingPlaces(), searchProgress: [{ status: 'idle' }, running, running, done] })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      render(<DiscountsPage />)
      await showMissing(user)
      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Chivitos (Centro)' }))
      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Kamba' }))
      await user.click(screen.getByRole('button', { name: 'Buscar seleccionados (2)' }))

      const dialog = await screen.findByRole('dialog')
      expect(within(dialog).getByText('Buscar 2 lugares en Google')).toBeInTheDocument()
      expect(within(dialog).getByText('US$ 0,064')).toBeInTheDocument()
      expect(within(dialog).getByText('US$ 0,150')).toBeInTheDocument()
      expect(within(dialog).getByText('US$ 0,214')).toBeInTheDocument()
      expect(within(dialog).getByText(/promedio real de 214 lugares en los últimos 10 lotes/)).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Buscar' }))

      await waitFor(() => expect(fake.calls.find((call) => call.url === '/api/discounts/searches')?.body).toEqual({ rows: ['bbva:chivitos#x', 'itau:montevideo:kamba#x'] }))
      expect(await screen.findByText('Buscando lugares · 0 de 2')).toBeInTheDocument()
      expect(within(missingRow('Chivitos (Centro)')).getByText('Buscando en Google…')).toBeInTheDocument()
      fake.setSearches({ 'bbva:chivitos': [search({ status: 'review', ourPlace: { id: 'u2', name: 'Chivitos', status: 'review' } })] })
      const loads = fake.calls.filter((call) => call.url === '/api/discounts').length
      await act(async () => { await vi.advanceTimersByTimeAsync(SEARCH_POLL_MS * 2) })
      expect(await screen.findByText('Búsqueda terminada · 2 lugares')).toBeInTheDocument()
      expect(fake.calls.filter((call) => call.url === '/api/discounts').length).toBe(loads + 1)
      expect(screen.getByText(/2 búsquedas en Google · costo real US\$ 0,139/)).toBeInTheDocument()
      expect(within(screen.getByText('Enviados a revisión').closest('div')!).getByText('1')).toBeInTheDocument()
      expect(within(missingRow('Chivitos (Centro)')).getByText('En revisión')).toBeInTheDocument()
    })

    it('al recargar la página con una búsqueda en curso, sigue mostrando el progreso', async () => {
      server({ places: missingPlaces(), searchProgress: [job({ status: 'running', finishedAt: null, rows: [jobRow('bbva:chivitos#x', 'Chivitos', { state: 'extracting', outcome: null })] })] })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)
      expect(await screen.findByText('Buscando lugares · 0 de 1')).toBeInTheDocument()
      expect(within(missingRow('Chivitos (Centro)')).getByText('Extrayendo…')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Buscar seleccionados/ })).toBeDisabled()
    })

    const option = (id: string, name: string, patch: Partial<OurPlaceOption> = {}): OurPlaceOption => ({
      id, name, neighborhoodId: 'POCITOS', categories: ['restaurant'], status: 'published', instagram: null, brandKey: null, logoUrl: null, meters: null, score: null, reason: null, ...patch,
    })
    const ourPasiva = '00000000-0000-4000-8000-000000000011'
    const ourPasivaCentro = '00000000-0000-4000-8000-000000000012'
    const ourKambaSushi = '00000000-0000-4000-8000-000000000013'
    const openPanel = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
      await user.click(screen.getByRole('button', { name: `Resolver ${name}` }))
      return screen.findByRole('dialog')
    }

    it('resolver: sugerencias por cercanía con la distancia; buscar en mis lugares (precargado) y vincular dos sucursales sin recargar', async () => {
      const fake = server({
        places: missingPlaces(),
        suggestions: [option(ourPasiva, 'Bar La Pasiva', { meters: 40, score: 0.7, reason: 'near' }), option('00000000-0000-4000-8000-000000000019', 'Otro Bar', { meters: 120, score: 0.1, reason: 'near' })],
        ours: [option(ourPasiva, 'Bar La Pasiva', { meters: 40 }), option(ourPasivaCentro, 'La Pasiva Centro', { neighborhoodId: 'CENTRO', status: 'review', meters: 2100 })],
      })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)
      const panel = await openPanel(user, 'La Pasiva')
      expect(within(panel).getByText('Ver en el sitio del banco')).toBeInTheDocument()
      expect(within(panel).getByText(/Av. Brasil 2580/)).toBeInTheDocument()
      const near = await within(panel).findByRole('list', { name: 'Cerca (hasta 300 m)' })
      expect(within(near).getByText('Otro Bar')).toBeInTheDocument()
      expect(within(near).getByText(/a 120 m/)).toBeInTheDocument()
      const suggestionsCall = fake.calls.find((call) => call.url === '/api/discounts/our-places/suggestions')
      expect(suggestionsCall?.body).toMatchObject({ name: 'La Pasiva', coordinates: POCITOS })
      // El buscador arranca con el nombre del banco.
      expect(within(panel).getByPlaceholderText('Nombre, Instagram o marca')).toHaveValue('La Pasiva')
      const results = await within(panel).findByRole('list', { name: 'Resultados en mis lugares' })
      expect(fake.calls.find((call) => call.url.startsWith('/api/discounts/our-places?'))?.url).toContain(`lat=${POCITOS.lat}`)
      expect(within(results).getByText('En revisión')).toBeInTheDocument()
      await user.click(within(results).getByRole('button', { name: 'Vincular Bar La Pasiva' }))
      // Los dos lugares del proveedor de la fila quedan vinculados (manual).
      await waitFor(() => expect(fake.calls.filter((call) => call.method === 'PUT').map((call) => call.url).sort()).toEqual(['/api/discounts/places/bbva%3Ala-pasiva/links', '/api/discounts/places/santander%3Ala-pasiva/links']))
      expect(await within(panel).findByRole('button', { name: 'Desvincular Lugar' })).toBeInTheDocument()
      await user.click(within(results).getByRole('button', { name: 'Vincular La Pasiva Centro' }))
      await waitFor(() => expect(fake.calls.at(-1)?.body).toEqual({ links: [{ placeId: ourPasiva, wholeBrand: false }, { placeId: ourPasivaCentro, wholeBrand: false }] }))
      // El panel sigue abierto (sucursales); la fila salió de la vista sin recargar.
      expect(fake.calls.filter((call) => call.url === '/api/discounts')).toHaveLength(1)
      await user.click(within(panel).getByRole('button', { name: 'Cerrar' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(screen.queryByText('La Pasiva')).not.toBeInTheDocument()
    })

    it('resolver: candidatos guardados con el nombre de nuevo (nunca el texto viejo), "Ya está en tu base" y "Agregar"', async () => {
      const candidates = [{ placeId: 'g-1', lat: -34.9, lng: -56.16 }, { placeId: 'g-2', lat: -34.91, lng: -56.17 }]
      const fake = server({
        places: missingPlaces(),
        searches: { 'itau:montevideo:kamba': [search({ status: 'doubtful', candidates })] },
        candidates: {
          costUsd: 0.034,
          searches: {},
          results: [
            { placeId: 'g-1', name: 'Kamba Sushi', address: 'Bvar. España 2500', lat: -34.9, lng: -56.16, meters: null, ours: { id: ourKambaSushi, name: 'Kamba', status: 'published' } },
            { placeId: 'g-2', name: 'Kamba Express', address: 'Rivera 3000', lat: -34.91, lng: -56.17, meters: null, ours: null },
          ],
        },
        pickSearches: { 'itau:montevideo:kamba': [search({ status: 'doubtful', candidates })] },
      })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)
      const panel = await openPanel(user, 'Kamba')
      expect(await within(panel).findByText('Kamba Sushi')).toBeInTheDocument()
      expect(fake.calls.find((call) => call.url === '/api/discounts/searches/candidates')?.body).toEqual({ rowKey: 'itau:montevideo:kamba#x' })
      expect(within(panel).getByText(/Rivera 3000/)).toBeInTheDocument()
      expect(screen.queryByText(/el nombre ya no está en memoria/)).not.toBeInTheDocument()
      expect(within(panel).getByText('Ya está en tu base: Kamba (publicado)')).toBeInTheDocument()
      expect(within(panel).getAllByRole('link', { name: /Google Maps/ })[0]).toHaveAttribute('href', expect.stringContaining('query_place_id=g-1'))
      expect(within(panel).getByText(/Datos de Google Maps · US\$ 0,034 en este panel/)).toBeInTheDocument()

      await user.click(within(panel).getByRole('button', { name: 'Agregar Kamba Express' }))
      await waitFor(() => expect(fake.calls.find((call) => call.url === '/api/discounts/searches/pick')?.body).toEqual({ rowKey: 'itau:montevideo:kamba#x', placeId: 'g-2' }))
      // Se cerró y el progreso se vuelve a pedir.
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(fake.calls.filter((call) => call.url === '/api/discounts/searches/current').length).toBeGreaterThan(1)
    })

    it('resolver: "Buscar en Google" muestra los resultados y "Ninguno" lo deja no encontrado; "Ya está en tu base" se vincula', async () => {
      const google: GoogleCandidatesResponse = {
        costUsd: 0.032,
        searches: { 'bbva:chivitos': [search({ status: 'doubtful', candidates: [{ placeId: 'g-9', lat: -34.9, lng: -56.19 }] })] },
        results: [{ placeId: 'g-9', name: 'Chivitos Marcos', address: '18 de Julio 1200', lat: -34.9, lng: -56.19, meters: null, ours: { id: ourKamba, name: 'Kamba', status: 'review' } }],
      }
      const fake = server({ places: missingPlaces(), google, pickSearches: { 'bbva:chivitos': [search({ status: 'not_found' })] } })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)
      let panel = await openPanel(user, 'Chivitos')
      await user.click(within(panel).getByRole('button', { name: /Buscar en Google/ }))
      expect(await within(panel).findByText('Chivitos Marcos')).toBeInTheDocument()
      expect(fake.calls.find((call) => call.url === '/api/discounts/searches/google')?.body).toEqual({ rowKey: 'bbva:chivitos#x' })
      expect(within(panel).getByText('Ya está en tu base: Kamba (en revisión)')).toBeInTheDocument()
      expect(within(missingRow('Chivitos (Centro)')).getByText('Dudoso')).toBeInTheDocument()
      await user.click(within(panel).getByRole('button', { name: 'Ninguno para Chivitos' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(fake.calls.filter((call) => call.url === '/api/discounts/searches/pick').at(-1)?.body).toEqual({ rowKey: 'bbva:chivitos#x', placeId: null })
      expect(within(missingRow('Chivitos (Centro)')).getByText('No encontrado')).toBeInTheDocument()
      expect(fake.calls.filter((call) => call.url === '/api/discounts')).toHaveLength(1)

      panel = await openPanel(user, 'Chivitos')
      await user.click(within(panel).getByRole('button', { name: /Buscar de nuevo|Buscar en Google/ }))
      await user.click(await within(panel).findByRole('button', { name: 'Vincular Kamba' }))
      await waitFor(() => expect(fake.calls.at(-1)).toMatchObject({ method: 'PUT', url: '/api/discounts/places/bbva%3Achivitos/links', body: { links: [{ placeId: ourKamba, wholeBrand: false }] } }))
    })

    it('después de descartar en el panel, el foco pasa al "Resolver" de la próxima fila sin resolver', async () => {
      const fake = server({ places: missingPlaces(), searches: { 'bbva:ya-buscado': [search({ status: 'exists', ourPlace: { id: 'u1', name: 'Ya Buscado', status: 'published' } })] } })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)
      // Orden: Centro (Chivitos, Ya Buscado), Pocitos (La Pasiva), Sin barrio (Kamba). Ya Buscado ya está resuelto.
      const panel = await openPanel(user, 'Chivitos')
      await user.click(within(panel).getByRole('button', { name: 'Descartar Chivitos' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(fake.calls.at(-1)).toMatchObject({ url: '/api/discounts/places/ignored', body: { ids: ['bbva:chivitos'], ignored: true } })
      expect(screen.queryByText('Chivitos')).not.toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Resolver La Pasiva' })).toHaveFocus())

      // "Siguiente sin resolver" abre la próxima directamente.
      const next = await openPanel(user, 'La Pasiva')
      await user.click(within(next).getByRole('button', { name: 'Siguiente sin resolver' }))
      expect(await screen.findByText('Resolver «Kamba»')).toBeInTheDocument()
    })

    it('descartar en la fila y "Descartar seleccionados" en la vista', async () => {
      const fake = server({ places: missingPlaces() })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await showMissing(user)
      await user.click(screen.getByRole('button', { name: 'Descartar Kamba' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Resolver Kamba' })).not.toBeInTheDocument())
      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar La Pasiva (Pocitos)' }))
      await user.click(screen.getByRole('checkbox', { name: 'Seleccionar Chivitos (Centro)' }))
      await user.click(screen.getByRole('button', { name: 'Descartar seleccionados (2)' }))
      await waitFor(() => expect(screen.getByText(/1 lugar sin repetir/)).toBeInTheDocument())
      expect(fake.calls.at(-1)?.body).toEqual({ ids: expect.arrayContaining(['bbva:la-pasiva', 'santander:la-pasiva', 'bbva:chivitos']), ignored: true })
    })

    it('un dudoso de la tabla común se resuelve con sus candidatos del cruce primero (sin Google)', async () => {
      const fake = server({ suggestions: [option(ourChelato, 'Chelato', { neighborhoodId: 'CARRASCO', score: 0.9, reason: 'candidate' })] })
      const user = userEvent.setup()
      render(<DiscountsPage />)
      await screen.findByText('Porterhouse')
      const panel = await openPanel(user, 'Chelato')
      expect(await within(panel).findByText(/candidato del cruce/)).toBeInTheDocument()
      expect(fake.calls.find((call) => call.url === '/api/discounts/our-places/suggestions')?.body).toMatchObject({ candidateIds: [ourChelato] })
      expect(within(panel).queryByText('Buscar en Google')).not.toBeInTheDocument()
      await user.click(within(panel).getByRole('button', { name: 'Vincular Chelato' }))
      expect(await within(panel).findByRole('button', { name: 'Desvincular Chelato' })).toBeInTheDocument()
      expect(within(row('Chelato')).getByText('Manual')).toBeInTheDocument()
    })
  })
})
