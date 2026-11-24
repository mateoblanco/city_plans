import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import type { GoogleFlagsStore } from './store.ts'

const ID = '00000000-0000-4000-8000-000000000001'
const fake = (overrides: Partial<GoogleFlagsStore> = {}): GoogleFlagsStore => ({
  list: vi.fn().mockResolvedValue({ flags: [], stale: 0, lastRun: null }),
  ignore: vi.fn().mockResolvedValue(true),
  unpublish: vi.fn().mockResolvedValue('unpublished'),
  ...overrides,
})
const json = (body: unknown) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

describe('rutas de Avisos de Google', () => {
  it('GET devuelve los avisos sin cache; 503 sin base y 500 si falla', async () => {
    const store = fake()
    const response = await createApp({ googleFlags: store }).request('/api/google-flags')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ flags: [], stale: 0, lastRun: null })

    expect((await createApp().request('/api/google-flags')).status).toBe(503)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = await createApp({ googleFlags: fake({ list: vi.fn().mockRejectedValue(new Error('x')) }) }).request('/api/google-flags')
    expect(failed.status).toBe(500)
    error.mockRestore()
  })

  it('Ignorar valida el id y el cuerpo', async () => {
    const store = fake()
    const app = createApp({ googleFlags: store })
    expect((await app.request(`/api/google-flags/${ID}/ignored`, json({ ignored: true }))).status).toBe(200)
    expect(store.ignore).toHaveBeenCalledWith(ID)
    expect((await app.request('/api/google-flags/no-uuid/ignored', json({ ignored: true }))).status).toBe(400)
    expect((await app.request(`/api/google-flags/${ID}/ignored`, json({ ignored: false }))).status).toBe(400)
    const gone = createApp({ googleFlags: fake({ ignore: vi.fn().mockResolvedValue(false) }) })
    expect((await gone.request(`/api/google-flags/${ID}/ignored`, json({ ignored: true }))).status).toBe(404)
  })

  it('Despublicar: 200 con el resultado, 400 con un id inválido, 404 si el aviso ya no está abierto', async () => {
    const store = fake()
    const app = createApp({ googleFlags: store })
    const response = await app.request(`/api/google-flags/${ID}/unpublish`, { method: 'POST' })
    expect(await response.json()).toEqual({ id: ID, outcome: 'unpublished' })
    expect((await app.request('/api/google-flags/x/unpublish', { method: 'POST' })).status).toBe(400)
    const gone = createApp({ googleFlags: fake({ unpublish: vi.fn().mockResolvedValue('not_found') }) })
    expect((await gone.request(`/api/google-flags/${ID}/unpublish`, { method: 'POST' })).status).toBe(404)
  })
})
