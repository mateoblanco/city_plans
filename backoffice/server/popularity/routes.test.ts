import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { popularityReader } from './list.ts'

describe('GET /api/popularity', () => {
  it('devuelve hoy (Montevideo) y las filas; no-store', async () => {
    const list = vi.fn().mockResolvedValue({ today: '2026-11-15', rows: [] })
    const response = await createApp({ popularityReader: { list } }).request('/api/popularity')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ today: '2026-11-15', rows: [] })
  })

  it('503 sin base y 500 si falla', async () => {
    expect((await createApp().request('/api/popularity')).status).toBe(503)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failed = await createApp({ popularityReader: { list: vi.fn().mockRejectedValue(new Error('boom')) } }).request('/api/popularity')
    expect(failed.status).toBe(500)
    error.mockRestore()
  })

  it('el lector usa el día de Montevideo: a las 01:00 UTC todavía es ayer', async () => {
    const run = vi.fn().mockResolvedValue([])
    const result = await popularityReader(run).list(new Date('2026-11-15T01:00:00Z'))
    expect(result.today).toBe('2026-11-14')
    expect(run.mock.calls[0][1]).toEqual(['2026-10-15', '2026-11-07', '2026-11-14'])
  })
})
