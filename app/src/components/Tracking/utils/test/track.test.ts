import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableTracking, markOrigin, originFor, resetTracking, startView, track, trackView, type EventPayload } from '../track'
import { sendEvent } from '../send'
import { whenVisible } from '../view'
import { directionsHandlers } from '../directions'

afterEach(() => resetTracking())

describe('origen de la ficha', () => {
  it('el click marca el origen y la vista de esa ficha lo usa una sola vez', () => {
    markOrigin('cafe-uno', { origin: 'home', row: 'breakfast' })
    expect(startView('id-1', 'cafe-uno')).toEqual({ origin: 'home', row: 'breakfast' })
    // Recarga o atrás: ya no hay click pendiente.
    expect(startView('id-1', 'cafe-uno')).toEqual({ origin: 'direct', row: null })
  })

  it('similares y sucursales', () => {
    markOrigin('bar-dos', { origin: 'similar', row: null })
    expect(startView('id-2', 'bar-dos').origin).toBe('similar')
    markOrigin('bar-dos-centro', { origin: 'branch', row: null })
    expect(startView('id-3', 'bar-dos-centro').origin).toBe('branch')
  })

  it('un click a otra ficha (p. ej. abierta en otra pestaña) no se le pega a esta: directo', () => {
    markOrigin('otra', { origin: 'search', row: null })
    expect(startView('id-1', 'cafe-uno')).toEqual({ origin: 'direct', row: null })
  })

  it('guardar y "Google Maps" en la ficha usan el origen de su vista', () => {
    markOrigin('cafe-uno', { origin: 'search', row: null })
    startView('id-1', 'cafe-uno')
    expect(originFor('id-1')).toEqual({ origin: 'search', row: null })
    expect(originFor('id-otro')).toEqual({ origin: 'direct', row: null })
  })
})

describe('track', () => {
  it('apagado (sin TrackingEnabled) no envía nada, ni por sendBeacon ni por fetch', () => {
    const sendBeacon = vi.fn()
    const fetcher = vi.fn()
    vi.stubGlobal('navigator', { sendBeacon })
    vi.stubGlobal('fetch', fetcher)
    track('id-1', 'save')
    track('id-1', 'directions')
    expect(sendBeacon).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('prendido envía con el origen de la ficha o el que se pasa (card)', () => {
    const sent: EventPayload[] = []
    enableTracking((payload) => sent.push(payload))
    markOrigin('cafe-uno', { origin: 'home', row: 'dinner' })
    startView('id-1', 'cafe-uno')
    track('id-1', 'directions')
    track('id-2', 'save', { origin: 'saved', row: 'saved' })
    expect(sent).toEqual([
      { placeId: 'id-1', type: 'directions', origin: 'home', row: 'dinner' },
      { placeId: 'id-2', type: 'save', origin: 'saved', row: 'saved' },
    ])
  })
})

describe('envío perezoso (send.ts en otro chunk)', () => {
  it('enableTracking() sin argumento y trackView mandan por send.ts', async () => {
    const sendBeacon = vi.fn(() => true)
    vi.stubGlobal('navigator', { sendBeacon })
    enableTracking()
    track('id-1', 'save', { origin: 'search', row: null })
    markOrigin('cafe-uno', { origin: 'branch', row: null })
    trackView('id-2', 'cafe-uno')
    await vi.waitFor(() => expect(sendBeacon).toHaveBeenCalledTimes(2))
    vi.unstubAllGlobals()
  })
})

describe('sendEvent', () => {
  const payload: EventPayload = { placeId: 'id-1', type: 'view', origin: 'direct', row: null }

  it('usa sendBeacon con text/plain', async () => {
    const sendBeacon = vi.fn(() => true)
    const fetcher = vi.fn()
    sendEvent(payload, { sendBeacon } as unknown as Navigator, fetcher)
    expect(sendBeacon).toHaveBeenCalledOnce()
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob]
    expect(url).toBe('/api/events')
    expect(blob.type).toBe('text/plain')
    expect(JSON.parse(await blob.text())).toEqual(payload)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('navegador automatizado (Lighthouse, Puppeteer, Playwright: navigator.webdriver): no envía', () => {
    const sendBeacon = vi.fn(() => true)
    const fetcher = vi.fn()
    sendEvent(payload, { webdriver: true, sendBeacon } as unknown as Navigator, fetcher)
    expect(sendBeacon).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('sin sendBeacon (o con la cola llena): fetch keepalive; si falla, se pierde sin error', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('offline')))
    expect(() => sendEvent(payload, {} as Navigator, fetcher as unknown as typeof fetch)).not.toThrow()
    expect(fetcher).toHaveBeenCalledWith('/api/events', expect.objectContaining({ method: 'POST', keepalive: true }))
    sendEvent(payload, { sendBeacon: () => false } as unknown as Navigator, fetcher as unknown as typeof fetch)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('whenVisible', () => {
  it('visible: corre ya', () => {
    const run = vi.fn()
    whenVisible({ visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() } as never, run)
    expect(run).toHaveBeenCalledOnce()
  })

  it('en segundo plano (prerender o pestaña oculta): espera a que se vea, una sola vez', () => {
    const listeners: Array<() => void> = []
    const doc = {
      visibilityState: 'hidden',
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.splice(listeners.indexOf(fn), 1),
    }
    const run = vi.fn()
    whenVisible(doc as never, run)
    expect(run).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'
    listeners[0]()
    expect(run).toHaveBeenCalledOnce()
    expect(listeners).toEqual([])
  })

  it('si se desmonta antes de verse, no corre', () => {
    const listeners = new Set<() => void>()
    const doc = {
      visibilityState: 'hidden',
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }
    const cleanup = whenVisible(doc as never, vi.fn())
    cleanup()
    expect(listeners.size).toBe(0)
  })
})

describe('"Cómo llegar" (link Google Maps)', () => {
  it('cuenta click y click del medio, nunca el derecho, y no frena la navegación', () => {
    const send = vi.fn()
    const handlers = directionsHandlers('id-1', send)
    handlers.onClick()
    handlers.onAuxClick({ button: 1 })
    handlers.onAuxClick({ button: 2 })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith('id-1', 'directions')
    // Los handlers no reciben el evento de click: no pueden llamar a preventDefault.
    expect(handlers.onClick.length).toBe(0)
  })
})
