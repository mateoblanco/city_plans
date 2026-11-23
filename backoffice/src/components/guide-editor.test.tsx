import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GuideDetail } from '@/types/guides'
import { GuideEditor } from './guide-editor'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
const place = (n: number) => ({ placeId: id(n), text: '', name: `Lugar ${n}`, slug: `lugar-${n}`, neighborhoodId: 'CORDON', status: 'published' })

const detail = (patch: Partial<GuideDetail> = {}): GuideDetail => ({
  id: 'g1', slug: 'cafes', city: 'montevideo', neighborhoodId: 'CORDON', group: 'cafes', title: 'Cafés', seoTitle: '', seoDescription: '', intro: '',
  status: 'draft', featured: false, color: '#FF8E00', publishedAt: null, contentUpdatedAt: '2026-11-19T12:00:00Z', aiCostUsd: 0.1, places: [place(1), place(2)], ...patch,
})

type Route = (url: string, init?: RequestInit) => Promise<Response> | undefined

function stub(route: Route) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/guides/ai-status') return json({ model: 'anthropic/claude-opus-5.5', balanceUsd: 12.5, creditUrl: 'https://vercel.com/credit' })
    if (url === '/api/guides/neighborhood-counts') return json({ min: 3, counts: { CORDON: 2, POCITOS: 4 } })
    return route(url, init) ?? json({ error: { code: 'X', message: `sin ruta ${url}` } }, 404)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const bodyOf = (fetch: ReturnType<typeof stub>, url: string) => JSON.parse(String((fetch.mock.calls.find(([input]) => String(input) === url)![1] as RequestInit).body))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('GuideEditor › candidatos desde una idea', () => {
  it('busca con el barrio y el grupo de la guía, marca los que ya están y agregar suma al final', async () => {
    const candidate = (n: number) => ({ id: id(n), name: `Lugar ${n}`, neighborhood: 'CORDON', categories: ['cafe'], iconCategory: 'coffee', logoUrl: null, logoBgColor: null, reasons: ['Para trabajar'], tags: ['work'], description: 'Un café tranquilo.' })
    const fetch = stub((url) => {
      if (url === '/api/guides/g1') return json({ guide: detail() })
      if (url === '/api/guides/candidates') return json({ candidates: [candidate(2), candidate(3)], notices: [] })
    })
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    await userEvent.type(await screen.findByPlaceholderText(/Idea: cafés tranquilos/), 'cafés tranquilos para trabajar')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar lugares' }))
    const list = await screen.findByRole('list', { name: 'Candidatos' })
    expect(bodyOf(fetch, '/api/guides/candidates')).toEqual({ idea: 'cafés tranquilos para trabajar', neighborhoodId: 'CORDON', group: 'cafes' })
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('En la guía')
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Por qué apareció: Para trabajar')
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Un café tranquilo.')
    await userEvent.click(within(list).getByRole('button', { name: 'Agregar Lugar 3 a la guía' }))
    const places = screen.getByRole('list', { name: 'Lugares de la guía' })
    expect(within(places).getAllByRole('listitem').map((item) => item.querySelector('.font-medium')?.textContent)).toEqual(['Lugar 1', 'Lugar 2', 'Lugar 3'])
    expect(within(list).getAllByText('En la guía')).toHaveLength(2)
  })
})

describe('GuideEditor › página del barrio', () => {
  it('al lado del barrio, cuántas guías publicadas tiene y el mínimo para que aparezca su página', async () => {
    stub((url) => (url === '/api/guides/g1' ? json({ guide: detail() }) : undefined))
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    expect(await screen.findByText('La página de este barrio aparece cuando tiene 3 guías publicadas (hoy: 2).')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Barrio'), 'POCITOS')
    expect(screen.getByText('La página de este barrio ya aparece: tiene 4 guías publicadas (mínimo 3).')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Barrio'), 'BUCEO')
    expect(screen.getByText('La página de este barrio aparece cuando tiene 3 guías publicadas (hoy: 0).')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Barrio'), '')
    expect(screen.queryByText(/La página de este barrio/)).not.toBeInTheDocument()
  })
})

describe('GuideEditor › slug sin IA', () => {
  it('en un borrador sigue al título (sin tildes ni ñ); editado a mano deja de seguirlo', async () => {
    stub((url) => (url === '/api/guides/g1' ? json({ guide: detail() }) : undefined))
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    const title = await screen.findByLabelText('Título')
    await userEvent.clear(title)
    await userEvent.type(title, 'Cafés con ñandú en Peñarol')
    const slug = screen.getByDisplayValue('cafes-con-nandu-en-penarol')
    await userEvent.clear(slug)
    await userEvent.type(slug, 'mi-slug')
    await userEvent.type(title, ' y más')
    expect(screen.getByDisplayValue('mi-slug')).toBeInTheDocument()
  })

  it('una guía ya publicada: el slug queda fijo aunque cambie el título', async () => {
    stub((url) => (url === '/api/guides/g1' ? json({ guide: detail({ status: 'published', publishedAt: '2026-11-01T12:00:00Z' }) }) : undefined))
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    const title = await screen.findByLabelText('Título')
    await userEvent.type(title, ' de Cordón')
    expect(screen.getByDisplayValue('cafes')).toBeInTheDocument()
    expect(screen.getByText(/Fijo: la guía ya se publicó/)).toBeInTheDocument()
  })
})

describe('GuideEditor › color de la tarjeta', () => {
  it('marca el de la guía y guardar manda el elegido', async () => {
    const fetch = stub((url, init) => {
      if (url === '/api/guides/g1' && init?.method === 'PUT') return json({ guide: detail({ color: '#6C12DD' }) })
      if (url === '/api/guides/g1') return json({ guide: detail() })
      return undefined
    })
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    expect(await screen.findByRole('radio', { name: 'Naranja 1' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Violeta 2' }))
    expect(screen.getByRole('radio', { name: 'Violeta 2' })).toBeChecked()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(fetch.mock.calls.some(([url, init]) => String(url) === '/api/guides/g1' && (init as RequestInit | undefined)?.method === 'PUT')).toBe(true))
    const put = fetch.mock.calls.find(([url, init]) => String(url) === '/api/guides/g1' && (init as RequestInit | undefined)?.method === 'PUT')!
    expect(JSON.parse(String((put[1] as RequestInit).body)).guide.color).toBe('#6C12DD')
  })
})

describe('GuideEditor › textos con IA', () => {
  it('lo generado se carga en el campo como borrador (sin guardar), con su costo y el total de la guía', async () => {
    const fetch = stub((url) => {
      if (url === '/api/guides/g1') return json({ guide: detail() })
      if (url === '/api/guides/generate') return json({ value: { kind: 'intro', intro: 'Cafés para quedarse.\n\nCon mesa y enchufe.' }, costUsd: 0.021, guideCostUsd: 0.121 })
    })
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Generar la introducción con IA' }))
    await waitFor(() => expect(screen.getByLabelText('Introducción')).toHaveValue('Cafés para quedarse.\n\nCon mesa y enchufe.'))
    expect(bodyOf(fetch, '/api/guides/generate')).toMatchObject({ kind: 'intro', guideId: 'g1', draft: { group: 'cafes', neighborhoodId: 'CORDON', places: [{ placeId: id(1) }, { placeId: id(2) }] } })
    expect(screen.getByText('US$ 0,021')).toBeInTheDocument()
    expect(screen.getByText(/Gastado en IA en esta guía: US\$ 0,121/)).toBeInTheDocument()
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument()
    // Nunca se guarda solo.
    expect(fetch.mock.calls.some(([url, init]) => String(url) === '/api/guides/g1' && (init as RequestInit | undefined)?.method === 'PUT')).toBe(false)
    expect(screen.getByRole('button', { name: 'Regenerar la introducción con IA' })).toBeInTheDocument()
  })

  it('generar el título también mueve el slug de un borrador', async () => {
    stub((url) => {
      if (url === '/api/guides/g1') return json({ guide: detail() })
      if (url === '/api/guides/generate') return json({ value: { kind: 'title', title: 'Cafés para laburar tranquilo' }, costUsd: 0.01, guideCostUsd: 0.11 })
    })
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerar el título con IA' }))
    await waitFor(() => expect(screen.getByLabelText('Título')).toHaveValue('Cafés para laburar tranquilo'))
    expect(screen.getByDisplayValue('cafes-para-laburar-tranquilo')).toBeInTheDocument()
  })

  it('respuesta inválida: error claro y no carga nada', async () => {
    stub((url) => {
      if (url === '/api/guides/g1') return json({ guide: detail({ seoTitle: 'Antes' }) })
      if (url === '/api/guides/generate') return json({ error: { code: 'AI_INVALID_OUTPUT', message: 'El texto generado menciona un precio que no está en los datos. Volvé a generar.' }, costUsd: 0.02, guideCostUsd: 0.12 }, 422)
    })
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: /el título y la descripción para Google con IA/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/menciona un precio/)
    expect(screen.getByLabelText('Título para Google')).toHaveValue('Antes')
    expect(screen.getByText(/Gastado en IA en esta guía: US\$ 0,120/)).toBeInTheDocument()
  })

  it('sin crédito (402): mensaje con el link para cargar y los botones se apagan', async () => {
    stub((url) => {
      if (url === '/api/guides/g1') return json({ guide: detail() })
      if (url === '/api/guides/generate') return json({ error: { code: 'AI_NO_CREDIT', message: 'El AI Gateway no tiene crédito: cargá crédito y volvé a intentar.' }, creditUrl: 'https://vercel.com/credit', costUsd: 0, guideCostUsd: null }, 402)
    })
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Generar el texto de Lugar 1 con IA' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((alert) => /no tiene crédito/.test(alert.textContent ?? ''))).toBe(true)
    expect(screen.getAllByRole('link', { name: /Cargar crédito/ })[0]).toHaveAttribute('href', 'https://vercel.com/credit')
    expect(screen.getByRole('button', { name: 'Generar la introducción con IA' })).toBeDisabled()
  })

  it('generar los vacíos: completa sólo los vacíos y avisa los que fallaron', async () => {
    stub((url) => {
      if (url === '/api/guides/g1') return json({ guide: detail({ places: [{ ...place(1), text: 'Escrito a mano.' }, place(2), place(3)] }) })
      if (url === '/api/guides/generate') return json({ value: { kind: 'places-empty', texts: [{ placeId: id(2), text: 'Generado 2.' }], errors: [{ placeId: id(3), message: 'El texto generado menciona un horario.' }] }, costUsd: 0.04, guideCostUsd: 0.14 })
    })
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Generar los textos vacíos (2) con IA' }))
    await waitFor(() => expect(screen.getByLabelText('Texto de Lugar 2')).toHaveValue('Generado 2.'))
    expect(screen.getByLabelText('Texto de Lugar 1')).toHaveValue('Escrito a mano.')
    expect(screen.getByLabelText('Texto de Lugar 3')).toHaveValue('')
    expect(screen.getByRole('alert')).toHaveTextContent(/1 no se pudo generar/)
  })

  it('con saldo 0 antes de generar: el aviso con el link y los botones apagados', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/guides/ai-status') return json({ model: 'anthropic/claude-opus-5.5', balanceUsd: 0, creditUrl: 'https://vercel.com/credit' })
      if (url === '/api/guides/g1') return json({ guide: detail() })
      return json({}, 404)
    }))
    render(<GuideEditor guideId="g1" onBack={() => {}} />)
    expect(await screen.findByText(/El AI Gateway no tiene crédito: los botones de IA están apagados/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerar el título con IA' })).toBeDisabled()
  })
})
