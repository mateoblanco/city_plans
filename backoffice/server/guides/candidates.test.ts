import { describe, expect, it, vi } from 'vitest'
import { CandidatesError, CANDIDATES_MAX, findCandidates, searchUrl } from './candidates.ts'

const result = (n: number) => ({
  id: `p${n}`, name: `Lugar ${n}`, neighborhood: 'CORDON', categories: ['cafe'], iconCategory: 'coffee', logoUrl: null, logoBgColor: null, reasons: [`Motivo ${n}`],
})
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

describe('candidatos desde una idea', () => {
  it('la búsqueda lleva el barrio y el grupo, todo Montevideo como ubicación y sin perfil ni horario', () => {
    const url = new URL(searchUrl('http://localhost:3000/', { idea: ' cafés tranquilos para trabajar ', neighborhoodId: 'CORDON', group: 'cafes' }))
    expect(url.origin + url.pathname).toBe('http://localhost:3000/api/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'cafés tranquilos para trabajar', intent: 'cafes', loc: 'all', profile: 'off', f: 'neighborhood:CORDON' })
    expect(url.search).not.toMatch(/open|remove|sub=|debug|near/)
  })

  it('toda la ciudad: sin filtro de barrio', () => {
    const url = new URL(searchUrl('https://app.example', { idea: 'sushi para una cita', neighborhoodId: null, group: 'eat' }))
    expect(url.searchParams.has('f')).toBe(false)
    expect(url.searchParams.get('intent')).toBe('eat')
    expect(url.searchParams.get('loc')).toBe('all')
  })

  it('los primeros 30, con los motivos de la búsqueda y tags y descripción de la base; sin cookies', async () => {
    const fetch = vi.fn(() => ok({ results: Array.from({ length: 45 }, (_, i) => result(i + 1)), relaxed: [{ message: 'Había pocos.' }], nearby: { results: [result(99)] } }))
    const extras = vi.fn(async (ids: string[]) => ids.map((id) => ({ id, tags: ['work'], descriptionEs: `Descripción de ${id}` })))
    const response = await findCandidates({ idea: 'cafés', neighborhoodId: 'CORDON', group: 'cafes' }, { appUrl: 'http://app', extras, fetch })
    expect(response.candidates).toHaveLength(CANDIDATES_MAX)
    expect(response.candidates[0]).toMatchObject({ id: 'p1', reasons: ['Motivo 1'], tags: ['work'], description: 'Descripción de p1', neighborhood: 'CORDON' })
    expect(response.candidates.some((candidate) => candidate.id === 'p99')).toBe(false)
    expect(response.notices).toEqual(['Había pocos.'])
    expect(extras).toHaveBeenCalledWith(Array.from({ length: 30 }, (_, i) => `p${i + 1}`))
    const init = (fetch.mock.calls[0] as unknown[])[1] as RequestInit
    expect(new Headers(init.headers).has('cookie')).toBe(false)
  })

  it('sin APP_URL: 503; la app caída o con error: 502', async () => {
    const extras = async () => []
    await expect(findCandidates({ idea: 'x y', neighborhoodId: null, group: 'eat' }, { appUrl: undefined, extras })).rejects.toMatchObject({ status: 503 })
    await expect(findCandidates({ idea: 'x y', neighborhoodId: null, group: 'eat' }, { appUrl: 'http://app', extras, fetch: () => Promise.reject(new Error('ECONNREFUSED')) })).rejects.toBeInstanceOf(CandidatesError)
    await expect(findCandidates({ idea: 'x y', neighborhoodId: null, group: 'eat' }, { appUrl: 'http://app', extras, fetch: () => Promise.resolve(new Response('{}', { status: 500 })) })).rejects.toMatchObject({ status: 502 })
  })
})
