import { describe, expect, it, vi } from 'vitest'
import { createPlaceSlugsCache, PLACE_SLUGS_MAX_AGE_MS, placeProxyAction, placeSlugOf } from '../slugs-cache'

const SLUGS = ['ramona', 'cafe-de-la-plaza']

describe('404 real de la ficha en el proxy', () => {
  const published = new Set(SLUGS)

  it('una ficha publicada pasa', () => {
    expect(placeProxyAction('/place/ramona', published)).toBe('next')
    expect(placeProxyAction('/place/cafe-de-la-plaza/', published)).toBe('next')
  })

  it('un slug que no existe o no está publicado (borrador, en revisión, oculto: no está en la lista) es 404', () => {
    expect(placeProxyAction('/place/no-existe', published)).toBe('notFound')
    expect(placeProxyAction('/place/un-borrador', published)).toBe('notFound')
  })

  it('un slug inválido es 404 sin mirar la lista (también si la base falló)', () => {
    expect(placeProxyAction('/place/Ramona', null)).toBe('notFound')
    expect(placeProxyAction('/place/%E2%9C%93', null)).toBe('notFound')
    expect(placeProxyAction('/place/%ZZ', null)).toBe('notFound')
    expect(placeProxyAction('/place/a/b', published)).toBe('notFound')
  })

  it('sin lista (la base falló): deja pasar a la página, que hace su notFound()', () => {
    expect(placeProxyAction('/place/no-existe', null)).toBe('next')
  })

  it('placeSlugOf', () => {
    expect(placeSlugOf('/place/ramona')).toBe('ramona')
    expect(placeSlugOf('/place/')).toBeNull()
    expect(placeSlugOf('/places/ramona')).toBeNull()
  })
})

describe('lista de slugs (sin consulta por pedido)', () => {
  it('muchos pedidos, una sola consulta (también los concurrentes de una instancia nueva)', async () => {
    const load = vi.fn().mockResolvedValue(SLUGS)
    const cache = createPlaceSlugsCache({ load })
    const first = await Promise.all(Array.from({ length: 20 }, () => cache.slugs()))
    for (let index = 0; index < 100; index++) await cache.slugs()
    expect(load).toHaveBeenCalledTimes(1)
    expect(first.every(({ slugs }) => slugs?.has('ramona'))).toBe(true)
  })

  it('vencida (más de un minuto): responde con la vieja sin esperar y la rearma en segundo plano, una sola vez', async () => {
    let now = 0
    const load = vi.fn().mockResolvedValueOnce(SLUGS).mockResolvedValueOnce([...SLUGS, 'recien-publicado'])
    const cache = createPlaceSlugsCache({ load, now: () => now })
    await cache.slugs()
    now = PLACE_SLUGS_MAX_AGE_MS + 1
    const stale = await Promise.all([cache.slugs(), cache.slugs()])
    expect(stale.every(({ slugs }) => slugs?.has('ramona') && !slugs.has('recien-publicado'))).toBe(true)
    // La tarea de segundo plano (para waitUntil) sale en la respuesta.
    const background = stale.map(({ background }) => background).filter(Boolean)
    expect(background.length).toBeGreaterThan(0)
    await Promise.all(background)
    expect((await cache.slugs()).slugs?.has('recien-publicado')).toBe(true)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('si la base falla sin lista: null y se reintenta en el próximo pedido', async () => {
    const onError = vi.fn()
    const load = vi.fn().mockRejectedValueOnce(new Error('sin base')).mockResolvedValueOnce(SLUGS)
    const cache = createPlaceSlugsCache({ load, onError })
    expect((await cache.slugs()).slugs).toBeNull()
    expect(onError).toHaveBeenCalled()
    expect((await cache.slugs()).slugs?.size).toBe(2)
  })

  it('una instancia nueva usa la Runtime Cache sin ir a la base; un valor roto cuenta como que no estaba', async () => {
    const store = { get: vi.fn().mockResolvedValue({ v: SLUGS, at: Date.now() }), set: vi.fn().mockResolvedValue(undefined) }
    const load = vi.fn()
    expect((await createPlaceSlugsCache({ load, remote: store }).slugs()).slugs?.size).toBe(2)
    expect(load).not.toHaveBeenCalled()

    const broken = { get: vi.fn().mockResolvedValue({ v: ['<script>'], at: Date.now() }), set: vi.fn().mockResolvedValue(undefined) }
    const reload = vi.fn().mockResolvedValue(SLUGS)
    expect((await createPlaceSlugsCache({ load: reload, remote: broken }).slugs()).slugs?.has('ramona')).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
