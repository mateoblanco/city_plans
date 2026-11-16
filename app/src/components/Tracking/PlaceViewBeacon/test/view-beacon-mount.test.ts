import { describe, expect, it, vi } from 'vitest'

// Sin DOM en estos tests: el efecto corre al "montar" (llamar al componente), como en el navegador después de mostrarse.
const sendEvent = vi.fn()
// El import() de track.ts resuelve a este mock.
vi.mock('../../utils/send', () => ({ sendEvent }))
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), useEffect: (effect: () => void) => effect() }))

const { default: PlaceViewBeacon } = await import('../PlaceViewBeacon')
const { markOrigin } = await import('../../utils/track')

describe('PlaceViewBeacon al montarse en el navegador', () => {
  it('visible: manda la vista con el origen del click', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
    markOrigin('cafe-uno', { origin: 'search', row: null })
    PlaceViewBeacon({ placeId: 'id-1', slug: 'cafe-uno' })
    await vi.waitFor(() => expect(sendEvent).toHaveBeenCalledWith({ placeId: 'id-1', type: 'view', origin: 'search', row: null }))
    vi.unstubAllGlobals()
  })

  it('oculta (prerender del navegador o pestaña en segundo plano): no manda hasta verse', async () => {
    sendEvent.mockClear()
    vi.stubGlobal('document', { visibilityState: 'hidden', addEventListener: vi.fn(), removeEventListener: vi.fn() })
    PlaceViewBeacon({ placeId: 'id-1', slug: 'cafe-uno' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sendEvent).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
